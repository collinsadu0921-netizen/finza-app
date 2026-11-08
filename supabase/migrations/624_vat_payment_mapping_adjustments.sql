-- ============================================================================
-- Migration 624: VAT payment mapping, negative components and adjustments
-- ============================================================================
-- Scope:
--   * Resolve VAT/NHIL/GETFund/COVID control accounts through the business
--     control map with a validated 2100-2130 fallback (F-16).
--   * Allow a legitimate net payable when an individual levy component is
--     negative; credit the control account instead of rejecting the filing
--     (F-12).
--   * Treat output/input adjustments as VAT control (2100) movements. The
--     adjustment must already exist in the ledger and have a reason; the
--     payment journal clears the resulting liability without creating an
--     extra debit balance (F-13).
--
-- Existing posted journals and returns are not rewritten.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Mapping-aware tax control account resolver
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finza_tax_control_account_code(
  p_business_id UUID,
  p_control_key TEXT,
  p_default_code TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_code TEXT;
BEGIN
  IF p_business_id IS NULL OR NULLIF(BTRIM(COALESCE(p_control_key, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT cm.account_code
  INTO v_code
  FROM public.chart_of_accounts_control_map cm
  WHERE cm.business_id = p_business_id
    AND cm.control_key = p_control_key
  LIMIT 1;

  IF v_code IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.chart_of_accounts c
      WHERE c.business_id = p_business_id
        AND c.account_code = v_code
        AND c.is_active
        AND LOWER(COALESCE(c.account_type, '')) = 'liability'
    ) THEN
      RETURN v_code;
    END IF;
    -- Explicit mapping is invalid: do not silently replace it.
    RETURN NULL;
  END IF;

  IF p_default_code IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.chart_of_accounts c
    WHERE c.business_id = p_business_id
      AND c.account_code = p_default_code
      AND c.is_active
      AND LOWER(COALESCE(c.account_type, '')) = 'liability'
  ) THEN
    RETURN p_default_code;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.finza_tax_control_account_code(UUID, TEXT, TEXT) IS
  'Returns the active liability control account for a tax control key. Explicit mappings win; invalid explicit mappings return NULL rather than silently falling back. Default 2100-2130 is used only when no mapping exists.';

REVOKE ALL ON FUNCTION public.finza_tax_control_account_code(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finza_tax_control_account_code(UUID, TEXT, TEXT)
  TO authenticated, service_role, postgres;

-- ----------------------------------------------------------------------------
-- 2) Atomic, idempotent, mapping-aware VAT payment
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
  v_account_code TEXT;
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

  v_adjustment_total := ROUND(
    COALESCE(v_return.output_adjustment, 0) -
    COALESCE(v_return.input_adjustment, 0),
    2
  );

  IF ABS(v_adjustment_total) > 0.009
     AND NULLIF(BTRIM(COALESCE(v_return.adjustment_reason, '')), '') IS NULL THEN
    PERFORM public.raise_vat_payment_error(
      'VAT_PAYMENT_ADJUSTMENT_REASON_REQUIRED',
      'A reason is required for VAT output/input adjustments before payment.',
      jsonb_build_object('adjustment_total', v_adjustment_total)
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

  -- Filing component split. The adjustment is a VAT control (2100) movement
  -- and must already exist in the ledger. It is added to the 2100 component
  -- once, not posted as a separate payment line.
  FOR v_row IN
    SELECT *
    FROM (
      VALUES
        ('2100'::TEXT, 'VAT Payable'::TEXT, 'VAT_PAYABLE'::TEXT, '2100'::TEXT,
          ROUND(COALESCE(v_return.total_output_vat, 0), 2),
          ROUND(COALESCE(v_return.total_input_vat, 0), 2)),
        ('2110'::TEXT, 'NHIL Payable'::TEXT, 'NHIL_PAYABLE'::TEXT, '2110'::TEXT,
          ROUND(COALESCE(v_return.total_output_nhil, 0), 2),
          ROUND(COALESCE(v_return.total_input_nhil, 0), 2)),
        ('2120'::TEXT, 'GETFund Payable'::TEXT, 'GETFUND_PAYABLE'::TEXT, '2120'::TEXT,
          ROUND(COALESCE(v_return.total_output_getfund, 0), 2),
          ROUND(COALESCE(v_return.total_input_getfund, 0), 2)),
        ('2130'::TEXT, 'COVID Levy Payable'::TEXT, 'COVID_PAYABLE'::TEXT, '2130'::TEXT,
          ROUND(COALESCE(v_return.total_output_covid, 0), 2),
          ROUND(COALESCE(v_return.total_input_covid, 0), 2))
    ) AS t(code, name, control_key, default_code, output_amount, input_amount)
    ORDER BY code
  LOOP
    CONTINUE WHEN NOT (
      v_row.code = '2100'
      OR (v_is_post_2026 AND v_row.code IN ('2110', '2120'))
    );

    v_component := ROUND(v_row.output_amount - v_row.input_amount, 2);

    IF v_row.default_code = '2100' THEN
      v_component := ROUND(v_component + v_adjustment_total, 2);
    END IF;

    v_account_code := public.finza_tax_control_account_code(
      v_return.business_id,
      v_row.control_key,
      v_row.default_code
    );

    IF v_account_code IS NULL AND ABS(v_component) > 0.01 THEN
      PERFORM public.raise_vat_payment_error(
        'VAT_PAYMENT_ACCOUNT_MISSING',
        'Tax control account for ' || v_row.name || ' is not configured as an active liability account for this business.',
        jsonb_build_object(
          'control_key', v_row.control_key,
          'default_code', v_row.default_code
        )
      );
    END IF;

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
      AND a.code = v_account_code
      AND a.deleted_at IS NULL;

    v_component_total := ROUND(v_component_total + v_component, 2);
    v_ledger_total := ROUND(v_ledger_total + v_ledger_amount, 2);

    v_breakdown := v_breakdown || jsonb_build_array(
      jsonb_build_object(
        'code', COALESCE(v_account_code, v_row.default_code),
        'name', v_row.name,
        'filing', v_component,
        'ledger', v_ledger_amount,
        'difference', ROUND(v_component - v_ledger_amount, 2)
      )
    );

    IF ABS(v_component) <= 0.01 THEN
      CONTINUE;
    END IF;

    SELECT a.id
    INTO v_account_id
    FROM public.accounts a
    WHERE a.business_id = v_return.business_id
      AND a.code = v_account_code
      AND a.deleted_at IS NULL
    LIMIT 1;

    IF v_account_id IS NULL THEN
      PERFORM public.raise_vat_payment_error(
        'VAT_PAYMENT_ACCOUNT_MISSING',
        'Tax control account ' || COALESCE(v_account_code, v_row.default_code) || ' is not configured for this business.',
        jsonb_build_object('code', COALESCE(v_account_code, v_row.default_code))
      );
    END IF;

    IF v_component > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_account_id,
          'debit', v_component,
          'description', 'VAT payment - ' || v_row.name
        )
      );
    ELSE
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_account_id,
          'credit', ABS(v_component),
          'description', 'VAT payment - ' || v_row.name || ' (net credit component)'
        )
      );
    END IF;
  END LOOP;

  v_filing_total := v_component_total;

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

  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object(
      'account_id', v_account.id,
      'credit', v_filing_total,
      'description', 'VAT payment - bank/cash'
    )
  );

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
  'Atomically posts and links a submitted VAT payment. Uses control-map accounts with validated 2100-2130 fallback, nets negative levy components, requires adjustment reasons, reconciles filing to ledger movement, and is idempotent by linked payment journal.';

REVOKE ALL ON FUNCTION public.post_vat_return_payment_atomic(UUID, DATE, UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_vat_return_payment_atomic(UUID, DATE, UUID, TEXT)
  TO authenticated;
