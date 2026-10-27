-- ============================================================================
-- Migration 598: Separate accounting view permission from journal write authority
-- ============================================================================
-- Migration 597 required accounting.view for direct post_journal_entry() calls.
-- That still allowed:
--   * accountant_readonly members to post direct journals;
--   * managers granted custom accounting.view to post via the system mode;
--   * Service/Professional tenants below the Business tier to post direct journals.
--
-- This migration adds a dedicated write-authority check for direct calls only.
-- Trigger-driven invoice/bill/payment/credit/expense/sale posting and
-- service-role source posting are unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.finza_assert_direct_journal_write_authorized(
  p_business_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_readonly BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'LEDGER_POSTING_PERMISSION_DENIED: authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.finza_user_can_access_business(p_business_id) THEN
    RAISE EXCEPTION 'LEDGER_POSTING_FORBIDDEN: no access to this business'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.finza_business_can_write_service_records(p_business_id) THEN
    RAISE EXCEPTION 'LEDGER_POSTING_SUBSCRIPTION_READ_ONLY: financial writes are locked for this business'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.finza_business_has_service_min_tier(p_business_id, 'business') THEN
    RAISE EXCEPTION 'LEDGER_POSTING_TIER_REQUIRED: the Business plan or higher is required for direct journal posting'
      USING ERRCODE = '42501';
  END IF;

  -- Business owner is the top authority and is never accountant_readonly.
  IF EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.id = p_business_id
      AND b.owner_id = v_uid
  ) THEN
    RETURN;
  END IF;

  SELECT bu.role, COALESCE(bu.accountant_readonly, FALSE)
  INTO v_role, v_readonly
  FROM public.business_users bu
  WHERE bu.business_id = p_business_id
    AND bu.user_id = v_uid
  LIMIT 1;

  IF v_role NOT IN ('admin', 'accountant') THEN
    RAISE EXCEPTION 'LEDGER_POSTING_PERMISSION_DENIED: owner, admin or accountant authority is required for direct journal posting'
      USING ERRCODE = '42501';
  END IF;

  IF v_readonly THEN
    RAISE EXCEPTION 'LEDGER_POSTING_READ_ONLY: accountant access is read-only'
      USING ERRCODE = '42501';
  END IF;

  -- Custom permission grants cannot turn a non-accounting role into a writer.
  -- This check also preserves explicit revocation for admin/accountant members.
  IF NOT public.finza_user_has_permission(p_business_id, 'accounting.view') THEN
    RAISE EXCEPTION 'LEDGER_POSTING_PERMISSION_DENIED: accounting authority is required for direct journal posting'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.finza_assert_direct_journal_write_authorized(UUID) IS
  'Direct journal write guard. Requires business access, write entitlement, Business tier for Service/Professional, owner/admin/accountant role, and non-readonly accounting authority.';

REVOKE ALL ON FUNCTION public.finza_assert_direct_journal_write_authorized(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finza_assert_direct_journal_write_authorized(UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.post_journal_entry(p_business_id uuid, p_date date, p_description text, p_reference_type text, p_reference_id uuid, p_lines jsonb, p_is_adjustment boolean DEFAULT false, p_adjustment_reason text DEFAULT NULL::text, p_adjustment_ref text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid, p_entry_type text DEFAULT NULL::text, p_backfill_reason text DEFAULT NULL::text, p_backfill_actor text DEFAULT NULL::text, p_posted_by_accountant_id uuid DEFAULT NULL::uuid, p_posting_source text DEFAULT NULL::text, p_is_revenue_correction boolean DEFAULT false, p_reverses_entry_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  journal_id UUID;
  line JSONB;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  account_id UUID;
  system_accountant_id UUID;
  revenue_account_id UUID;
  has_revenue_line BOOLEAN := FALSE;
  invoice_status TEXT;
  v_scale INT := 2;
  v_currency TEXT;
  v_timezone TEXT;
  v_normalized_date DATE;
  v_period_id UUID;
  v_accounting_start_date DATE;
BEGIN
  IF auth.uid() IS NOT NULL
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND pg_trigger_depth() = 0 THEN
    PERFORM public.finza_assert_direct_journal_write_authorized(p_business_id);
  END IF;

  IF p_posting_source IS NULL THEN
    RAISE EXCEPTION 'posting_source is required and must be explicitly set to ''system'' or ''accountant''';
  END IF;
  IF p_posting_source NOT IN ('system', 'accountant') THEN
    RAISE EXCEPTION 'posting_source must be ''system'' or ''accountant''. Found: %', p_posting_source;
  END IF;

  -- Scoped: only enforce adjustment-specific rules when entry IS an adjustment
  -- or a reversal (both use is_adjustment for period rules). Allow reference_type
  -- 'adjustment' (standalone) or 'reversal' (references original JE).
  IF p_is_adjustment = TRUE THEN
    IF p_adjustment_reason IS NULL OR TRIM(p_adjustment_reason) = '' THEN
      RAISE EXCEPTION 'Adjustment entries require a non-empty adjustment_reason';
    END IF;
    IF p_reference_type NOT IN ('adjustment', 'reversal') THEN
      RAISE EXCEPTION 'Adjustment/reversal entries must have reference_type = ''adjustment'' or ''reversal''. Found: %', p_reference_type;
    END IF;
    IF p_reference_type = 'reversal' THEN
      IF p_reference_id IS NULL THEN
        RAISE EXCEPTION 'Reversal entries must have reference_id = original journal entry id.';
      END IF;
    ELSIF p_reference_type = 'adjustment' THEN
      IF p_reference_id IS NOT NULL AND COALESCE(p_is_revenue_correction, FALSE) = FALSE THEN
        RAISE EXCEPTION 'Adjustment entries must have reference_id = NULL unless explicitly a revenue correction (is_revenue_correction = true).';
      END IF;
    END IF;
  ELSE
    IF p_adjustment_reason IS NOT NULL OR p_adjustment_ref IS NOT NULL THEN
      RAISE EXCEPTION 'Non-adjustment entries cannot have adjustment_reason or adjustment_ref';
    END IF;
  END IF;

  IF p_entry_type = 'backfill' THEN
    IF p_backfill_reason IS NULL OR TRIM(p_backfill_reason) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_reason';
    END IF;
    IF p_backfill_actor IS NULL OR TRIM(p_backfill_actor) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_actor';
    END IF;
  END IF;

  revenue_account_id := get_account_by_code(p_business_id, '4000');
  IF revenue_account_id IS NOT NULL THEN
    FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
      IF (line->>'account_id')::UUID = revenue_account_id THEN
        has_revenue_line := TRUE;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF has_revenue_line THEN
    IF p_reference_type = 'payment' THEN
      RAISE EXCEPTION 'Revenue is recognized only on invoice issuance. Payments cannot post revenue.';
    END IF;
    IF p_reference_type = 'invoice' THEN
      IF p_reference_id IS NULL THEN
        RAISE EXCEPTION 'Revenue journal entries must reference an issued invoice (reference_id required).';
      END IF;
      SELECT status INTO invoice_status FROM invoices WHERE id = p_reference_id AND business_id = p_business_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Revenue journal entries must reference an issued invoice. Invoice not found: %', p_reference_id;
      END IF;
      IF invoice_status = 'draft' THEN
        RAISE EXCEPTION 'Draft invoices cannot post revenue. Issue the invoice first.';
      END IF;
    ELSIF p_reference_type = 'credit_note' THEN
      IF p_reference_id IS NULL THEN
        RAISE EXCEPTION 'Revenue journal entries for credit notes must reference the credit note (reference_id required).';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM credit_notes
        WHERE id = p_reference_id
          AND business_id = p_business_id
          AND status = 'applied'
          AND deleted_at IS NULL
      ) THEN
        RAISE EXCEPTION 'Revenue journal lines for credit_note must reference an applied credit note. Credit note not found or not applied: %', p_reference_id;
      END IF;
    ELSIF p_reference_type = 'reversal' THEN
      -- Reversals can contain revenue lines (reversing original entry); no extra validation
      NULL;
    ELSIF p_reference_type IN ('adjustment', 'reconciliation') THEN
      IF COALESCE(p_is_revenue_correction, FALSE) = FALSE THEN
        RAISE EXCEPTION 'Reconciliation/adjustment entries cannot post revenue unless explicitly flagged as revenue correction (is_revenue_correction = true).';
      END IF;
      IF p_reference_id IS NULL THEN
        RAISE EXCEPTION 'Revenue correction entries must reference an issued invoice (reference_id required).';
      END IF;
      SELECT status INTO invoice_status FROM invoices WHERE id = p_reference_id AND business_id = p_business_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Revenue correction must reference an issued invoice. Invoice not found: %', p_reference_id;
      END IF;
      IF invoice_status = 'draft' THEN
        RAISE EXCEPTION 'Revenue correction must reference an issued invoice. Draft invoice: %', p_reference_id;
      END IF;
    ELSIF p_reference_type = 'sale' THEN
      IF p_posting_source <> 'system' THEN
        RAISE EXCEPTION 'Revenue journal lines for reference_type = sale are allowed only for automated system postings (posting_source = system).';
      END IF;
      IF p_reference_id IS NULL THEN
        RAISE EXCEPTION 'Revenue journal entries for retail POS sales must reference the sale (reference_id required).';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM sales
        WHERE id = p_reference_id
          AND business_id = p_business_id
      ) THEN
        RAISE EXCEPTION 'Revenue journal lines for sale must reference an existing sale for this business. Sale not found: %', p_reference_id;
      END IF;
    ELSE
      RAISE EXCEPTION 'Revenue journal lines are only allowed for invoice issuance (reference_type = invoice), credit notes (reference_type = credit_note), reversals (reference_type = reversal), retail POS (reference_type = sale), or explicitly flagged revenue corrections (reference_type = adjustment/reconciliation, is_revenue_correction = true).';
    END IF;
  END IF;

  SELECT COALESCE(default_currency, 'USD')
  INTO v_currency
  FROM businesses
  WHERE id = p_business_id;
  v_scale := get_currency_scale(v_currency);

  SELECT timezone, accounting_start_date INTO v_timezone, v_accounting_start_date
  FROM businesses
  WHERE id = p_business_id;
  v_normalized_date := (p_date::timestamp AT TIME ZONE COALESCE(v_timezone, 'UTC'))::date;

  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    total_debit := total_debit +
      ROUND(COALESCE((line->>'debit')::NUMERIC, 0), v_scale);
    total_credit := total_credit +
      ROUND(COALESCE((line->>'credit')::NUMERIC, 0), v_scale);
  END LOOP;
  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry must balance. Debit: %, Credit: %', total_debit, total_credit;
  END IF;

  IF p_posting_source = 'system' AND p_posted_by_accountant_id IS NULL THEN
    SELECT owner_id INTO system_accountant_id FROM businesses WHERE id = p_business_id;
    IF system_accountant_id IS NULL THEN
      RAISE EXCEPTION 'Cannot post journal entry: Business owner not found for business %. System accountant required for automatic posting.', p_business_id;
    END IF;
  END IF;

  IF v_accounting_start_date IS NOT NULL AND v_normalized_date < v_accounting_start_date THEN
    IF COALESCE(TRIM(p_entry_type), '') NOT IN ('opening_balance', 'backfill') THEN
      RAISE EXCEPTION 'Posting date precedes accounting adoption date. Use opening balance or backfill.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT id INTO v_period_id
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND v_normalized_date >= period_start
    AND v_normalized_date <= period_end
  ORDER BY period_start DESC
  LIMIT 1;
  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'No accounting period found for business % and date %. Posting is not allowed.', p_business_id, v_normalized_date
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM assert_accounting_period_is_open(p_business_id, v_normalized_date, p_is_adjustment);

  INSERT INTO journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    created_by,
    is_adjustment,
    adjustment_reason,
    adjustment_ref,
    entry_type,
    backfill_reason,
    backfill_actor,
    posted_by_accountant_id,
    posting_source,
    period_id,
    reverses_entry_id
  )
  VALUES (
    p_business_id,
    v_normalized_date,
    p_description,
    p_reference_type,
    p_reference_id,
    COALESCE(p_created_by, system_accountant_id, p_posted_by_accountant_id),
    p_is_adjustment,
    p_adjustment_reason,
    p_adjustment_ref,
    p_entry_type,
    p_backfill_reason,
    p_backfill_actor,
    COALESCE(p_posted_by_accountant_id, system_accountant_id),
    p_posting_source,
    v_period_id,
    p_reverses_entry_id
  )
  RETURNING id INTO journal_id;

  INSERT INTO journal_entry_lines (
    journal_entry_id,
    account_id,
    debit,
    credit,
    description
  )
  SELECT
    journal_id,
    (jl->>'account_id')::UUID,
    ROUND(COALESCE((jl->>'debit')::NUMERIC, 0)::NUMERIC, v_scale),
    ROUND(COALESCE((jl->>'credit')::NUMERIC, 0)::NUMERIC, v_scale),
    jl->>'description'
  FROM jsonb_array_elements(p_lines) AS jl;

  RETURN journal_id;
END;
$function$
;

COMMENT ON FUNCTION public.post_journal_entry(
  UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT,
  UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN, UUID
) IS
  'Core journal posting RPC. Direct authenticated callers require owner/admin/accountant write authority, non-readonly status and Business tier; trigger-driven and service-role source postings retain their existing authority.';
