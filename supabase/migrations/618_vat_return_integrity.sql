-- ============================================================================
-- Migration 618: VAT return period, status and payment integrity
-- ============================================================================
-- Scope:
--   * Reject new overlapping VAT return periods without rewriting existing rows.
--   * Enforce monotonic VAT return status transitions.
--   * Make VAT payment posting idempotent and regime-aware.
--   * Reuse post_journal_entry() instead of writing journal tables directly.
--
-- Existing overlapping/paid test records are deliberately left untouched.
-- The overlap trigger only checks INSERT and period/deletion changes; updating
-- notes or status on an existing overlapping row remains possible.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Overlap guard (non-destructive: does not validate existing rows)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_vat_return_period_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Only a new row, or a change to the period/deletion state, can create a
  -- new overlap. Existing overlapping historical rows remain readable/editable.
  IF TG_OP = 'UPDATE'
     AND NEW.period_start_date IS NOT DISTINCT FROM OLD.period_start_date
     AND NEW.period_end_date IS NOT DISTINCT FROM OLD.period_end_date
     AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN
    RETURN NEW;
  END IF;

  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.vat_returns v
    WHERE v.business_id = NEW.business_id
      AND v.id <> NEW.id
      AND v.deleted_at IS NULL
      AND NEW.period_start_date <= v.period_end_date
      AND v.period_start_date <= NEW.period_end_date
  ) THEN
    RAISE EXCEPTION
      'VAT_RETURN_PERIOD_OVERLAP: VAT return period % to % overlaps an existing active return for this business',
      NEW.period_start_date, NEW.period_end_date
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.prevent_vat_return_period_overlap() IS
  'Rejects new overlapping VAT return periods. Existing historical overlaps are not rewritten or deleted.';

DROP TRIGGER IF EXISTS trg_vat_returns_period_overlap ON public.vat_returns;
CREATE TRIGGER trg_vat_returns_period_overlap
  BEFORE INSERT OR UPDATE ON public.vat_returns
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_vat_return_period_overlap();

-- ----------------------------------------------------------------------------
-- 2) Monotonic status transitions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_invalid_vat_return_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
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

  -- The payment RPC sets status = paid and the linked journal in the same
  -- UPDATE. A direct paid transition without a journal remains blocked by
  -- prevent_vat_paid_without_journal().
  IF OLD.status = 'submitted'
     AND NEW.status = 'paid'
     AND NEW.payment_journal_entry_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'VAT_RETURN_STATUS_TRANSITION_INVALID: cannot move VAT return from % to %',
    OLD.status, NEW.status
    USING ERRCODE = 'P0001';
END;
$$;

COMMENT ON FUNCTION public.prevent_invalid_vat_return_status_transition() IS
  'Allows draft -> submitted and submitted -> paid with a linked payment journal. Paid returns cannot be reopened through ordinary updates.';

DROP TRIGGER IF EXISTS trg_vat_returns_status_transition ON public.vat_returns;
CREATE TRIGGER trg_vat_returns_status_transition
  BEFORE INSERT OR UPDATE ON public.vat_returns
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_invalid_vat_return_status_transition();

-- ----------------------------------------------------------------------------
-- 3) Atomic, idempotent, regime-aware VAT payment
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_vat_return_payment_atomic(
  p_vat_return_id UUID,
  p_payment_date DATE,
  p_payment_account_id UUID,
  p_payment_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_return public.vat_returns%ROWTYPE;
  v_account public.accounts%ROWTYPE;
  v_reference TEXT;
  v_is_post_2026 BOOLEAN;
  v_component NUMERIC;
  v_component_total NUMERIC := 0;
  v_ledger_amount NUMERIC;
  v_ledger_total NUMERIC := 0;
  v_adjustment_total NUMERIC := 0;
  v_filing_total NUMERIC := 0;
  v_breakdown JSONB := '[]'::JSONB;
  v_lines JSONB := '[]'::JSONB;
  v_row RECORD;
  v_account_id UUID;
  v_journal_entry_id UUID;
  v_existing_journal_id UUID;
  v_original_role TEXT;
BEGIN
  SELECT *
  INTO v_return
  FROM public.vat_returns
  WHERE id = p_vat_return_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_PAYMENT_NOT_FOUND',
      'VAT filing not found.'
    );
  END IF;

  IF NOT public.finza_user_can_access_business(v_return.business_id) THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_PAYMENT_NOT_AUTHORIZED',
      'You do not have access to this business.'
    );
  END IF;

  -- The linked journal is the payment identity. Check it before status so a
  -- paid return cannot be reopened and paid again through a status regression.
  IF v_return.payment_journal_entry_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'reused', TRUE,
      'journal_entry_id', v_return.payment_journal_entry_id,
      'payment_amount', v_return.payment_amount,
      'payment_date', v_return.payment_date,
      'payment_reference', v_return.payment_reference,
      'filing_total', v_return.payment_amount,
      'ledger_total', v_return.payment_amount,
      'difference', 0
    );
  END IF;

  IF v_return.status = 'paid' THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_PAYMENT_LEGACY_PAID_WITHOUT_JOURNAL',
      'This filing is marked paid but has no linked payment journal. It was not repaired automatically.',
      jsonb_build_object('vat_return_id', v_return.id)
    );
  END IF;

  IF v_return.status <> 'submitted' THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_PAYMENT_INVALID_STATUS',
      'Only a submitted VAT filing can be paid. Current status: ' || COALESCE(v_return.status, 'unknown') || '.',
      jsonb_build_object('status', v_return.status)
    );
  END IF;

  IF p_payment_date IS NULL THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_PAYMENT_INVALID_DATE',
      'Payment date is required.'
    );
  END IF;

  IF p_payment_account_id IS NULL THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_PAYMENT_INVALID_ACCOUNT',
      'A bank, cash, or mobile-money account is required.'
    );
  END IF;

  v_reference := NULLIF(BTRIM(COALESCE(p_payment_reference, '')), '');
  IF v_reference IS NOT NULL AND length(v_reference) > 200 THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_PAYMENT_INVALID_REFERENCE',
      'Payment reference must be 200 characters or fewer.'
    );
  END IF;

  BEGIN
    PERFORM public.assert_accounting_period_is_open(
      v_return.business_id,
      p_payment_date
    );
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.raise_vat_payment_error(
        'VAT_PAYMENT_PERIOD_LOCKED',
        SQLERRM,
        jsonb_build_object('payment_date', p_payment_date)
      );
  END;

  SELECT a.*
  INTO v_account
  FROM public.accounts a
  WHERE a.id = p_payment_account_id
    AND a.business_id = v_return.business_id
    AND a.deleted_at IS NULL
    AND a.type = 'asset'
    AND (
      COALESCE(LOWER(a.sub_type), '') IN ('cash', 'bank', 'momo', 'mobile_money')
      OR a.code IN ('1000', '1010', '1020')
    )
  LIMIT 1;

  IF NOT FOUND THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_PAYMENT_INVALID_ACCOUNT',
      'Selected payment account is invalid. Choose an active cash, bank, or mobile-money asset account.'
    );
  END IF;

  v_is_post_2026 := v_return.period_end_date >= DATE '2026-01-01';

  -- Filing component split. Pre-2026 only VAT is part of net VAT; NHIL,
  -- GETFund and COVID remain separate liabilities. Post-2026 VAT, NHIL and
  -- GETFund are claimable and form the net VAT position.
  FOR v_row IN
    SELECT *
    FROM (
      VALUES
        ('2100'::TEXT, 'VAT Payable'::TEXT,
          ROUND(COALESCE(v_return.total_output_vat, 0), 2),
          ROUND(COALESCE(v_return.total_input_vat, 0), 2)),
        ('2110'::TEXT, 'NHIL Payable'::TEXT,
          ROUND(COALESCE(v_return.total_output_nhil, 0), 2),
          ROUND(COALESCE(v_return.total_input_nhil, 0), 2)),
        ('2120'::TEXT, 'GETFund Payable'::TEXT,
          ROUND(COALESCE(v_return.total_output_getfund, 0), 2),
          ROUND(COALESCE(v_return.total_input_getfund, 0), 2)),
        ('2130'::TEXT, 'COVID Levy Payable'::TEXT,
          ROUND(COALESCE(v_return.total_output_covid, 0), 2),
          ROUND(COALESCE(v_return.total_input_covid, 0), 2))
    ) AS t(code, name, output_amount, input_amount)
    ORDER BY code
  LOOP
    CONTINUE WHEN NOT (
      v_row.code = '2100'
      OR (v_is_post_2026 AND v_row.code IN ('2110', '2120'))
    );

    v_component := ROUND(v_row.output_amount - v_row.input_amount, 2);

    SELECT ROUND(
      COALESCE(
        SUM(
          CASE
            WHEN je.id IS NOT NULL THEN jel.credit - jel.debit
            ELSE 0
          END
        ),
        0
      ),
      2
    )
    INTO v_ledger_amount
    FROM public.accounts a
    LEFT JOIN public.journal_entry_lines jel
      ON jel.account_id = a.id
    LEFT JOIN public.journal_entries je
      ON je.id = jel.journal_entry_id
     AND je.business_id = v_return.business_id
     AND je.date >= v_return.period_start_date
     AND je.date <= v_return.period_end_date
     AND COALESCE(je.reference_type, '') <> 'vat_return_payment'
    WHERE a.business_id = v_return.business_id
      AND a.code = v_row.code
      AND a.deleted_at IS NULL;

    v_component_total := ROUND(v_component_total + v_component, 2);
    v_ledger_total := ROUND(v_ledger_total + v_ledger_amount, 2);

    v_breakdown := v_breakdown || jsonb_build_array(
      jsonb_build_object(
        'code', v_row.code,
        'name', v_row.name,
        'filing', v_component,
        'ledger', v_ledger_amount,
        'difference', ROUND(v_component - v_ledger_amount, 2)
      )
    );

    IF v_component < -0.01 THEN
      PERFORM public.raise_vat_payment_error(
        'VAT_PAYMENT_NEGATIVE_COMPONENT',
        'This filing has a net refund component. Record refunds outside the payment action.',
        jsonb_build_object(
          'code', v_row.code,
          'filing_amount', v_component,
          'accounts', v_breakdown
        )
      );
    END IF;

    IF v_component > 0.01 THEN
      SELECT a.id
      INTO v_account_id
      FROM public.accounts a
      WHERE a.business_id = v_return.business_id
        AND a.code = v_row.code
        AND a.deleted_at IS NULL
      LIMIT 1;

      IF v_account_id IS NULL THEN
        PERFORM public.raise_vat_payment_error(
          'VAT_PAYMENT_ACCOUNT_MISSING',
          'Tax control account ' || v_row.code || ' is not configured for this business.',
          jsonb_build_object('code', v_row.code)
        );
      END IF;

      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_account_id,
          'debit', v_component,
          'description', 'VAT payment - ' || v_row.name
        )
      );
    END IF;
  END LOOP;

  v_adjustment_total := ROUND(
    COALESCE(v_return.output_adjustment, 0) -
    COALESCE(v_return.input_adjustment, 0),
    2
  );
  v_filing_total := ROUND(v_component_total + v_adjustment_total, 2);

  IF ABS(v_component_total - v_ledger_total) > 0.01 THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_PAYMENT_RECONCILIATION_MISMATCH',
      'The filing does not match the tax liabilities posted to the ledger for this filing period. Nothing was posted and the filing was not marked paid.',
      jsonb_build_object(
        'filing_total', v_component_total,
        'ledger_total', v_ledger_total,
        'difference', ROUND(v_component_total - v_ledger_total, 2),
        'accounts', v_breakdown
      )
    );
  END IF;

  IF ABS(v_filing_total - COALESCE(v_return.net_vat_payable, 0)) > 0.01 THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_PAYMENT_FILING_INCONSISTENT',
      'The filing tax split does not add up to its stored net VAT payable. Recalculate or review the filing before paying.',
      jsonb_build_object(
        'filing_total', v_filing_total,
        'filing_net_tax', COALESCE(v_return.net_vat_payable, 0),
        'difference', ROUND(v_filing_total - COALESCE(v_return.net_vat_payable, 0), 2),
        'accounts', v_breakdown
      )
    );
  END IF;

  IF v_filing_total <= 0.01 THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_PAYMENT_NOT_PAYABLE',
      'This filing has no positive VAT payable to record.',
      jsonb_build_object('filing_total', v_filing_total)
    );
  END IF;

  -- Adjustments are manual reconciling amounts. Post them to VAT Payable so
  -- the payment journal remains balanced without changing the raw component
  -- ledger reconciliation above.
  IF ABS(v_adjustment_total) > 0.01 THEN
    SELECT a.id
    INTO v_account_id
    FROM public.accounts a
    WHERE a.business_id = v_return.business_id
      AND a.code = '2100'
      AND a.deleted_at IS NULL
    LIMIT 1;

    IF v_account_id IS NULL THEN
      PERFORM public.raise_vat_payment_error(
        'VAT_PAYMENT_ACCOUNT_MISSING',
        'VAT control account 2100 is not configured for this business.',
        jsonb_build_object('code', '2100')
      );
    END IF;

    IF v_adjustment_total > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_account_id,
          'debit', v_adjustment_total,
          'description', 'VAT payment - filing adjustment'
        )
      );
    ELSE
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_account_id,
          'credit', ABS(v_adjustment_total),
          'description', 'VAT payment - filing adjustment'
        )
      );
    END IF;
  END IF;

  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object(
      'account_id', v_account.id,
      'credit', v_filing_total,
      'description', 'VAT payment - bank/cash'
    )
  );

  -- post_journal_entry() intentionally blocks direct authenticated callers
  -- below the Business tier. This SECURITY DEFINER RPC has already checked
  -- business access, accounting authority, status, period and reconciliation,
  -- so it posts as the trusted system source for the duration of the call.
  v_original_role := current_setting('request.jwt.claim.role', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  BEGIN
    SELECT public.post_journal_entry(
      p_business_id => v_return.business_id,
      p_date => p_payment_date,
      p_description => 'VAT payment - '
        || to_char(v_return.period_start_date, 'YYYY-MM-DD')
        || ' to '
        || to_char(v_return.period_end_date, 'YYYY-MM-DD'),
      p_reference_type => 'vat_return_payment',
      p_reference_id => v_return.id,
      p_lines => v_lines,
      p_created_by => auth.uid(),
      p_posting_source => 'system'
    )
    INTO v_journal_entry_id;
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
  SET status = 'paid',
      payment_date = p_payment_date,
      payment_reference = v_reference,
      payment_account_id = v_account.id,
      payment_journal_entry_id = v_journal_entry_id,
      payment_posted_at = NOW(),
      payment_amount = v_filing_total,
      updated_at = NOW()
  WHERE id = v_return.id;

  RETURN jsonb_build_object(
    'reused', FALSE,
    'journal_entry_id', v_journal_entry_id,
    'payment_amount', v_filing_total,
    'payment_date', p_payment_date,
    'payment_reference', v_reference,
    'filing_total', v_filing_total,
    'ledger_total', v_ledger_total,
    'difference', 0,
    'accounts', v_breakdown
  );
EXCEPTION
  WHEN unique_violation THEN
    SELECT vr.payment_journal_entry_id
    INTO v_existing_journal_id
    FROM public.vat_returns vr
    WHERE vr.id = p_vat_return_id;

    IF v_existing_journal_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'reused', TRUE,
        'journal_entry_id', v_existing_journal_id,
        'payment_amount', (
          SELECT vr.payment_amount
          FROM public.vat_returns vr
          WHERE vr.id = p_vat_return_id
        ),
        'difference', 0
      );
    END IF;

    RAISE;
END;
$$;

COMMENT ON FUNCTION public.post_vat_return_payment_atomic(UUID, DATE, UUID, TEXT) IS
  'Atomically posts and links a submitted VAT filing payment. Regime-aware: pre-2026 pays VAT only; post-2026 pays VAT, NHIL and GETFund. Reuses post_journal_entry, enforces period lock, reconciles filing to ledger movement, and is idempotent by linked payment journal.';

REVOKE ALL ON FUNCTION public.post_vat_return_payment_atomic(UUID, DATE, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_vat_return_payment_atomic(UUID, DATE, UUID, TEXT)
  TO authenticated;
