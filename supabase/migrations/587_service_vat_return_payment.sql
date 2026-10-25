-- ============================================================================
-- Migration 587: Service VAT return payment posting
--
-- Adds a real, atomic payment action for Service VAT filings:
--   * reconciles the filing's tax split against the filing period's ledger
--     movement on accounts 2100-2130 (never the full current account balance)
--   * posts Dr tax liabilities / Cr bank-cash
--   * links the journal to the filing and marks it paid
--   * is idempotent for retries/double-clicks
--   * refuses to mark a filing paid without a payment journal
--
-- Existing paid filings without a linked journal are intentionally left alone.
-- They are surfaced by the API/UI as "paid without payment" for manual review.
-- ============================================================================

ALTER TABLE public.vat_returns
  ADD COLUMN IF NOT EXISTS payment_journal_entry_id UUID
    REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS payment_account_id UUID
    REFERENCES public.accounts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS payment_posted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(14, 2);

CREATE UNIQUE INDEX IF NOT EXISTS ux_vat_returns_payment_journal_entry
  ON public.vat_returns(payment_journal_entry_id)
  WHERE payment_journal_entry_id IS NOT NULL;

COMMENT ON COLUMN public.vat_returns.payment_journal_entry_id IS
  'Journal entry that settled this VAT filing. NULL for legacy paid filings and unpaid filings.';
COMMENT ON COLUMN public.vat_returns.payment_account_id IS
  'Cash/bank/momo asset account credited when the VAT payment was posted.';
COMMENT ON COLUMN public.vat_returns.payment_posted_at IS
  'When the VAT payment journal was posted.';
COMMENT ON COLUMN public.vat_returns.payment_amount IS
  'Amount posted to the ledger for this filing payment.';

-- ---------------------------------------------------------------------------
-- Internal error helper. The API maps the raised code/detail to an HTTP
-- response; it never returns a successful status for a failed posting.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.raise_vat_payment_error(
  p_code TEXT,
  p_message TEXT,
  p_details JSONB DEFAULT '{}'::JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    USING ERRCODE = 'P0001',
          MESSAGE = p_code,
          DETAIL = (
            jsonb_build_object('message', p_message)
            || COALESCE(p_details, '{}'::JSONB)
          )::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.raise_vat_payment_error(TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.raise_vat_payment_error(TEXT, TEXT, JSONB)
  TO postgres;

-- ---------------------------------------------------------------------------
-- Database-level guard: a filing cannot transition into paid without a
-- linked payment journal. Legacy already-paid rows remain readable/editable
-- because the guard only fires on the transition into paid (or on insert).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_vat_paid_without_journal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'paid'
     AND NEW.payment_journal_entry_id IS NULL
     AND (
       TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM 'paid'
     )
  THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_PAYMENT_JOURNAL_REQUIRED',
      'A VAT filing cannot be marked paid without a linked payment journal. Use the Record payment action.',
      jsonb_build_object('vat_return_id', NEW.id)
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_vat_paid_without_journal()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_vat_paid_without_journal()
  TO postgres;

DROP TRIGGER IF EXISTS trg_prevent_vat_paid_without_journal
  ON public.vat_returns;

CREATE TRIGGER trg_prevent_vat_paid_without_journal
  BEFORE INSERT OR UPDATE ON public.vat_returns
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_vat_paid_without_journal();

-- ---------------------------------------------------------------------------
-- Atomic payment posting.
--
-- Reconciliation uses the filing period's movement on each tax control
-- account (credits - debits), excluding VAT payment journals. It deliberately
-- does NOT use the current cumulative account balance: prior-period balances
-- and later period postings do not belong to this filing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_vat_return_payment_atomic(
  p_vat_return_id UUID,
  p_payment_date DATE,
  p_payment_account_id UUID,
  p_payment_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_return public.vat_returns%ROWTYPE;
  v_account public.accounts%ROWTYPE;
  v_period_id UUID;
  v_reference TEXT;
  v_filing_total NUMERIC := 0;
  v_ledger_total NUMERIC := 0;
  v_difference NUMERIC := 0;
  v_net_payable NUMERIC := 0;
  v_breakdown JSONB := '[]'::JSONB;
  v_lines JSONB := '[]'::JSONB;
  v_row RECORD;
  v_line JSONB;
  v_journal_entry_id UUID;
  v_existing_journal_id UUID;
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

  -- Retry/double-click identity: the filing itself is the idempotency key.
  IF v_return.status = 'paid' THEN
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

  SELECT ap.id
  INTO v_period_id
  FROM public.accounting_periods ap
  WHERE ap.business_id = v_return.business_id
    AND p_payment_date BETWEEN ap.period_start AND ap.period_end
  ORDER BY ap.period_start DESC
  LIMIT 1;

  IF v_period_id IS NULL THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_PAYMENT_PERIOD_NOT_FOUND',
      'No accounting period covers the selected payment date.'
    );
  END IF;

  -- Filing split per tax control account.
  -- Ledger split is the filing period's net movement only (not cumulative).
  FOR v_row IN
    WITH filing(code, name, filing_amount) AS (
      VALUES
        (
          '2100',
          'VAT Payable',
          ROUND(COALESCE(v_return.total_output_vat, 0) - COALESCE(v_return.total_input_vat, 0), 2)
        ),
        (
          '2110',
          'NHIL Payable',
          ROUND(COALESCE(v_return.total_output_nhil, 0) - COALESCE(v_return.total_input_nhil, 0), 2)
        ),
        (
          '2120',
          'GETFund Payable',
          ROUND(COALESCE(v_return.total_output_getfund, 0) - COALESCE(v_return.total_input_getfund, 0), 2)
        ),
        (
          '2130',
          'COVID Levy Payable',
          ROUND(COALESCE(v_return.total_output_covid, 0) - COALESCE(v_return.total_input_covid, 0), 2)
        )
    ),
    ledger AS (
      SELECT
        a.code,
        a.id AS account_id,
        ROUND(
          COALESCE(
            SUM(
              CASE
                WHEN je.id IS NOT NULL THEN l.credit - l.debit
                ELSE 0
              END
            ),
            0
          ),
          2
        ) AS ledger_amount
      FROM public.accounts a
      LEFT JOIN public.journal_entry_lines l
        ON l.account_id = a.id
      LEFT JOIN public.journal_entries je
        ON je.id = l.journal_entry_id
       AND je.business_id = v_return.business_id
       AND je.date >= v_return.period_start_date
       AND je.date <= v_return.period_end_date
       AND COALESCE(je.reference_type, '') <> 'vat_return_payment'
      WHERE a.business_id = v_return.business_id
        AND a.code IN ('2100', '2110', '2120', '2130')
        AND a.deleted_at IS NULL
      GROUP BY a.code, a.id
    )
    SELECT
      f.code,
      f.name,
      f.filing_amount,
      COALESCE(l.ledger_amount, 0) AS ledger_amount,
      l.account_id
    FROM filing f
    LEFT JOIN ledger l ON l.code = f.code
    ORDER BY f.code
  LOOP
    v_filing_total := v_filing_total + v_row.filing_amount;
    v_ledger_total := v_ledger_total + v_row.ledger_amount;

    v_breakdown := v_breakdown || jsonb_build_array(
      jsonb_build_object(
        'code', v_row.code,
        'name', v_row.name,
        'filing', ROUND(v_row.filing_amount, 2),
        'ledger', ROUND(v_row.ledger_amount, 2),
        'difference', ROUND(v_row.filing_amount - v_row.ledger_amount, 2)
      )
    );

    IF v_row.filing_amount < -0.01 THEN
      PERFORM public.raise_vat_payment_error(
        'VAT_PAYMENT_NEGATIVE_COMPONENT',
        'This filing has a net refund component. Record refunds outside the payment action.',
        jsonb_build_object(
          'code', v_row.code,
          'filing_amount', ROUND(v_row.filing_amount, 2),
          'accounts', v_breakdown
        )
      );
    END IF;

    IF v_row.filing_amount > 0.01 THEN
      IF v_row.account_id IS NULL THEN
        PERFORM public.raise_vat_payment_error(
          'VAT_PAYMENT_ACCOUNT_MISSING',
          'Tax control account ' || v_row.code || ' is not configured for this business.',
          jsonb_build_object('code', v_row.code)
        );
      END IF;

      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_row.account_id,
          'code', v_row.code,
          'amount', ROUND(v_row.filing_amount, 2)
        )
      );
    END IF;
  END LOOP;

  v_filing_total := ROUND(v_filing_total, 2);
  v_ledger_total := ROUND(v_ledger_total, 2);
  v_difference := ROUND(v_filing_total - v_ledger_total, 2);
  v_net_payable := ROUND(
    COALESCE(v_return.total_output_tax, 0)
      - COALESCE(v_return.total_input_tax, 0),
    2
  );

  IF ABS(v_filing_total - v_net_payable) > 0.01 THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_PAYMENT_FILING_INCONSISTENT',
      'The filing tax split does not add up to its output minus input tax totals. Recalculate or review the filing before paying.',
      jsonb_build_object(
        'filing_total', v_filing_total,
        'filing_net_tax', v_net_payable,
        'difference', ROUND(v_filing_total - v_net_payable, 2),
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

  IF ABS(v_difference) > 0.01 THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_PAYMENT_RECONCILIATION_MISMATCH',
      'The filing does not match the tax liabilities posted to the ledger for this filing period. Nothing was posted and the filing was not marked paid.',
      jsonb_build_object(
        'filing_total', v_filing_total,
        'ledger_total', v_ledger_total,
        'difference', v_difference,
        'accounts', v_breakdown
      )
    );
  END IF;

  INSERT INTO public.journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    created_by,
    posting_source,
    period_id
  )
  VALUES (
    v_return.business_id,
    p_payment_date,
    'VAT payment - '
      || to_char(v_return.period_start_date, 'YYYY-MM-DD')
      || ' to '
      || to_char(v_return.period_end_date, 'YYYY-MM-DD'),
    'vat_return_payment',
    v_return.id,
    auth.uid(),
    'system',
    v_period_id
  )
  RETURNING id INTO v_journal_entry_id;

  INSERT INTO public.journal_entry_lines (
    journal_entry_id,
    account_id,
    debit,
    credit,
    description
  )
  SELECT
    v_journal_entry_id,
    (line ->> 'account_id')::UUID,
    (line ->> 'amount')::NUMERIC,
    0,
    'VAT payment - account ' || (line ->> 'code')
  FROM jsonb_array_elements(v_lines) AS line
  UNION ALL
  SELECT
    v_journal_entry_id,
    v_account.id,
    0,
    v_filing_total,
    'VAT payment - bank/cash';

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
    -- Concurrent retry: another request won the unique payment-journal link.
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
  'Atomically posts and links a Service VAT filing payment. Reconciles the filing tax split to the filing period ledger movement on 2100-2130, posts Dr tax liabilities / Cr cash-bank, and is idempotent per filing.';

REVOKE ALL ON FUNCTION public.post_vat_return_payment_atomic(UUID, DATE, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_vat_return_payment_atomic(UUID, DATE, UUID, TEXT)
  TO authenticated;
