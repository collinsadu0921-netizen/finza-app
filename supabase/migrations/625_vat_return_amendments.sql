-- ============================================================================
-- Migration 625: Controlled VAT return amendment and payment reversal
-- ============================================================================
-- Scope:
--   * Add an auditable amendment record linking an original filing to its
--     replacement draft.
--   * Add a controlled payment reversal that posts a new reversal journal
--     through post_journal_entry; posted journals are never modified.
--   * Allow paid -> submitted only when the payment has been reversed.
--   * Preserve unrestricted paid -> draft as forbidden.
--
-- Historical rows are not rewritten. The original filing remains readable with
-- status 'amended' after a replacement is created.
-- ============================================================================

ALTER TABLE public.vat_returns
  ADD COLUMN IF NOT EXISTS payment_reversal_journal_entry_id UUID
    REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS payment_reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_reversal_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_vat_returns_payment_reversal_journal
  ON public.vat_returns(payment_reversal_journal_entry_id)
  WHERE payment_reversal_journal_entry_id IS NOT NULL;

-- The amendment workflow adds a terminal 'amended' state for the original
-- filing. Existing statuses are unchanged.
ALTER TABLE public.vat_returns
  DROP CONSTRAINT IF EXISTS vat_returns_status_check;
ALTER TABLE public.vat_returns
  ADD CONSTRAINT vat_returns_status_check
  CHECK (status IN ('draft', 'submitted', 'paid', 'amended')) NOT VALID;
ALTER TABLE public.vat_returns
  VALIDATE CONSTRAINT vat_returns_status_check;

-- The amendment replacement shares the original filing's period. Relax the
-- legacy period uniqueness constraint only for terminal 'amended' rows; the
-- overlap trigger still prevents two active returns for the same period.
ALTER TABLE public.vat_returns
  DROP CONSTRAINT IF EXISTS vat_returns_business_id_period_start_date_period_end_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_vat_returns_active_period
  ON public.vat_returns (business_id, period_start_date, period_end_date)
  WHERE status <> 'amended';

CREATE TABLE IF NOT EXISTS public.vat_return_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  original_return_id UUID NOT NULL REFERENCES public.vat_returns(id) ON DELETE RESTRICT,
  amendment_return_id UUID NOT NULL REFERENCES public.vat_returns(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  evidence TEXT,
  reversal_journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (amendment_return_id)
);

CREATE INDEX IF NOT EXISTS idx_vat_return_amendments_original
  ON public.vat_return_amendments(original_return_id);
CREATE INDEX IF NOT EXISTS idx_vat_return_amendments_business
  ON public.vat_return_amendments(business_id);

ALTER TABLE public.vat_return_amendments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vat_return_amendments_business_read ON public.vat_return_amendments;
CREATE POLICY vat_return_amendments_business_read
  ON public.vat_return_amendments
  FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

REVOKE ALL ON TABLE public.vat_return_amendments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vat_return_amendments TO authenticated;

-- ----------------------------------------------------------------------------
-- Controlled status transitions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_invalid_vat_return_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION
        'VAT_RETURN_STATUS_TRANSITION_INVALID: new VAT returns must start as draft'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'submitted' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'submitted'
     AND NEW.status = 'paid'
     AND NEW.payment_journal_entry_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'submitted' AND NEW.status = 'amended' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'paid'
     AND NEW.status = 'submitted'
     AND NEW.payment_reversal_journal_entry_id IS NOT NULL
     AND NEW.payment_journal_entry_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'paid'
     AND NEW.status = 'amended'
     AND NEW.payment_reversal_journal_entry_id IS NOT NULL
     AND NEW.payment_journal_entry_id IS NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'VAT_RETURN_STATUS_TRANSITION_INVALID: cannot move VAT return from % to %',
    OLD.status, NEW.status
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_vat_returns_status_transition ON public.vat_returns;
CREATE TRIGGER trg_vat_returns_status_transition
  BEFORE INSERT OR UPDATE ON public.vat_returns
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_invalid_vat_return_status_transition();

-- ----------------------------------------------------------------------------
-- Reverse a paid VAT payment with a new journal; never modify the original
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_vat_return_payment(
  p_vat_return_id UUID,
  p_reversal_date DATE,
  p_reason TEXT,
  p_evidence TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_return public.vat_returns%ROWTYPE;
  v_line RECORD;
  v_lines JSONB := '[]'::JSONB;
  v_reversal_je UUID;
  v_original_role TEXT;
  v_reason TEXT := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
BEGIN
  SELECT *
  INTO v_return
  FROM public.vat_returns
  WHERE id = p_vat_return_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.raise_vat_payment_error('VAT_REVERSAL_NOT_FOUND', 'VAT filing not found.');
  END IF;

  PERFORM public.finza_assert_accounting_write_authorized(
    v_return.business_id,
    'professional'
  );

  IF v_return.payment_reversal_journal_entry_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'reused', TRUE,
      'reversal_journal_entry_id', v_return.payment_reversal_journal_entry_id,
      'vat_return_id', v_return.id
    );
  END IF;

  IF v_return.status <> 'paid' THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_REVERSAL_INVALID_STATUS',
      'Only a paid VAT filing can have its payment reversed.',
      jsonb_build_object('status', v_return.status)
    );
  END IF;

  IF v_return.payment_journal_entry_id IS NULL THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_REVERSAL_NO_PAYMENT_JOURNAL',
      'This paid filing has no linked payment journal. It cannot be reversed automatically.',
      jsonb_build_object('vat_return_id', v_return.id)
    );
  END IF;

  IF p_reversal_date IS NULL OR v_reason IS NULL THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_REVERSAL_REASON_REQUIRED',
      'A reversal date and reason are required.'
    );
  END IF;

  BEGIN
    PERFORM public.assert_accounting_period_is_open(
      v_return.business_id,
      p_reversal_date
    );
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.raise_vat_payment_error(
        'VAT_REVERSAL_PERIOD_LOCKED',
        SQLERRM,
        jsonb_build_object('reversal_date', p_reversal_date)
      );
  END;

  FOR v_line IN
    SELECT account_id, debit, credit, description
    FROM public.journal_entry_lines
    WHERE journal_entry_id = v_return.payment_journal_entry_id
    ORDER BY id
  LOOP
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', v_line.account_id,
        'debit', v_line.credit,
        'credit', v_line.debit,
        'description', 'VAT payment reversal - ' || COALESCE(v_line.description, '')
      )
    );
  END LOOP;

  IF jsonb_array_length(v_lines) = 0 THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_REVERSAL_JOURNAL_EMPTY',
      'The linked payment journal has no lines to reverse.',
      jsonb_build_object('journal_entry_id', v_return.payment_journal_entry_id)
    );
  END IF;

  v_original_role := current_setting('request.jwt.claim.role', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  BEGIN
    SELECT public.post_journal_entry(
      p_business_id => v_return.business_id,
      p_date => p_reversal_date,
      p_description => 'VAT payment reversal - '
        || to_char(v_return.period_start_date, 'YYYY-MM-DD')
        || ' to '
        || to_char(v_return.period_end_date, 'YYYY-MM-DD'),
      p_reference_type => 'reversal',
      p_reference_id => v_return.payment_journal_entry_id,
      p_lines => v_lines,
      p_is_adjustment => TRUE,
      p_adjustment_reason => v_reason,
      p_created_by => auth.uid(),
      p_posting_source => 'system',
      p_reverses_entry_id => v_return.payment_journal_entry_id
    )
    INTO v_reversal_je;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM set_config(
        'request.jwt.claim.role',
        COALESCE(v_original_role, ''),
        true
      );
      RAISE;
  END;
  PERFORM set_config(
    'request.jwt.claim.role',
    COALESCE(v_original_role, ''),
    true
  );

  UPDATE public.vat_returns
  SET status = 'submitted',
      payment_reversal_journal_entry_id = v_reversal_je,
      payment_reversed_at = NOW(),
      payment_reversal_reason = v_reason,
      payment_journal_entry_id = NULL,
      payment_date = NULL,
      payment_reference = NULL,
      payment_account_id = NULL,
      payment_posted_at = NULL,
      payment_amount = NULL,
      updated_at = NOW()
  WHERE id = v_return.id;

  RETURN jsonb_build_object(
    'reused', FALSE,
    'vat_return_id', v_return.id,
    'reversal_journal_entry_id', v_reversal_je,
    'reason', v_reason,
    'evidence', NULLIF(BTRIM(COALESCE(p_evidence, '')), '')
  );
END;
$$;

COMMENT ON FUNCTION public.reverse_vat_return_payment(UUID, DATE, TEXT, TEXT) IS
  'Posts a new reversal journal for a paid VAT filing payment, links it to the filing, and returns the filing to submitted. The original journal is never modified.';

REVOKE ALL ON FUNCTION public.reverse_vat_return_payment(UUID, DATE, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_vat_return_payment(UUID, DATE, TEXT, TEXT)
  TO authenticated;

-- ----------------------------------------------------------------------------
-- Create an auditable amendment draft linked to the original filing
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_vat_return_amendment(
  p_vat_return_id UUID,
  p_reason TEXT,
  p_evidence TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_original public.vat_returns%ROWTYPE;
  v_new_id UUID;
  v_amendment_id UUID;
  v_reason TEXT := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
BEGIN
  SELECT *
  INTO v_original
  FROM public.vat_returns
  WHERE id = p_vat_return_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.raise_vat_payment_error('VAT_AMENDMENT_NOT_FOUND', 'VAT filing not found.');
  END IF;

  PERFORM public.finza_assert_accounting_write_authorized(
    v_original.business_id,
    'professional'
  );

  IF v_reason IS NULL THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_AMENDMENT_REASON_REQUIRED',
      'A reason is required for a VAT amendment.'
    );
  END IF;

  IF v_original.status NOT IN ('submitted', 'paid') THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_AMENDMENT_INVALID_STATUS',
      'Only a submitted or paid filing can be amended.',
      jsonb_build_object('status', v_original.status)
    );
  END IF;

  IF v_original.status = 'paid'
     AND v_original.payment_reversal_journal_entry_id IS NULL THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_AMENDMENT_PAYMENT_REVERSAL_REQUIRED',
      'Reverse the paid filing payment before creating an amendment.',
      jsonb_build_object('vat_return_id', v_original.id)
    );
  END IF;

  UPDATE public.vat_returns
  SET status = 'amended',
      updated_at = NOW()
  WHERE id = v_original.id;

  INSERT INTO public.vat_returns (
    business_id,
    period_start_date,
    period_end_date,
    status,
    ledger_authority,
    total_taxable_sales,
    total_zero_rated_sales,
    total_exempt_sales,
    total_output_nhil,
    total_output_getfund,
    total_output_covid,
    total_output_vat,
    total_output_tax,
    total_taxable_purchases,
    total_zero_rated_purchases,
    total_exempt_purchases,
    total_input_nhil,
    total_input_getfund,
    total_input_covid,
    total_input_vat,
    total_input_tax,
    net_vat_payable,
    net_vat_refund,
    output_adjustment,
    input_adjustment,
    adjustment_reason,
    notes
  )
  VALUES (
    v_original.business_id,
    v_original.period_start_date,
    v_original.period_end_date,
    'draft',
    v_original.ledger_authority,
    v_original.total_taxable_sales,
    v_original.total_zero_rated_sales,
    v_original.total_exempt_sales,
    v_original.total_output_nhil,
    v_original.total_output_getfund,
    v_original.total_output_covid,
    v_original.total_output_vat,
    v_original.total_output_tax,
    v_original.total_taxable_purchases,
    v_original.total_zero_rated_purchases,
    v_original.total_exempt_purchases,
    v_original.total_input_nhil,
    v_original.total_input_getfund,
    v_original.total_input_covid,
    v_original.total_input_vat,
    v_original.total_input_tax,
    v_original.net_vat_payable,
    v_original.net_vat_refund,
    v_original.output_adjustment,
    v_original.input_adjustment,
    v_original.adjustment_reason,
    'Amendment of filing ' || v_original.id::TEXT
  )
  RETURNING id INTO v_new_id;

  INSERT INTO public.vat_return_amendments (
    business_id,
    original_return_id,
    amendment_return_id,
    reason,
    evidence,
    reversal_journal_entry_id,
    created_by
  )
  VALUES (
    v_original.business_id,
    v_original.id,
    v_new_id,
    v_reason,
    NULLIF(BTRIM(COALESCE(p_evidence, '')), ''),
    v_original.payment_reversal_journal_entry_id,
    auth.uid()
  )
  RETURNING id INTO v_amendment_id;

  RETURN jsonb_build_object(
    'amendment_id', v_amendment_id,
    'original_return_id', v_original.id,
    'amendment_return_id', v_new_id,
    'reversal_journal_entry_id', v_original.payment_reversal_journal_entry_id
  );
END;
$$;

COMMENT ON FUNCTION public.create_vat_return_amendment(UUID, TEXT, TEXT) IS
  'Creates an auditable replacement draft linked to a submitted or paid filing. Paid filings require a completed payment reversal first. The original filing is marked amended, never deleted or rewritten.';

REVOKE ALL ON FUNCTION public.create_vat_return_amendment(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_vat_return_amendment(UUID, TEXT, TEXT)
  TO authenticated;
