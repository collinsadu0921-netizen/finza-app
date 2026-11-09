-- ============================================================================
-- Migration 627: Ledger posting security correction (F-01)
-- ============================================================================
-- Scope:
--   * Reject anonymous and unauthorized direct journal posting.
--   * Harden the shared ledger insert guard to require full accounting-write
--     authority for direct authenticated inserts while preserving trusted
--     trigger-driven and service-role postings.
--   * Make the WHT ledger writer internal-only and idempotent so a retry or
--     concurrent request cannot create or repoint a duplicate journal.
--   * Make the request-metadata journal wrapper internal-only (it accepts a
--     caller-supplied actor UUID and must never be client-callable).
--   * Revoke PUBLIC/anon execution from every journal-posting RPC and grant
--     only the roles that legitimately need each function.
--
-- No financial rows, journal structures or accounting rules are changed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Shared ledger insert guard: full accounting authority for direct writes
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finza_assert_ledger_write_authorized(
  p_business_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT := COALESCE(
    NULLIF(BTRIM(auth.role()), ''),
    NULLIF(BTRIM(current_setting('request.jwt.claim.role', true)), ''),
    ''
  );
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_WRITE_UNAUTHORIZED: business_id is required'
      USING ERRCODE = '42501';
  END IF;

  -- Next.js/service-role and trusted background callers.
  IF v_role = 'service_role' THEN
    RETURN;
  END IF;

  -- Direct database sessions without an application JWT (migrations/jobs).
  IF v_role = '' AND session_user IN ('postgres', 'supabase_admin') THEN
    RETURN;
  END IF;

  IF v_role = 'anon' OR v_uid IS NULL THEN
    RAISE EXCEPTION 'LEDGER_WRITE_UNAUTHORIZED: authentication is required'
      USING ERRCODE = '42501';
  END IF;

  -- Nested trigger-driven postings (invoice/bill/payment/expense/retail)
  -- execute inside a trigger and are already governed by the source document
  -- and its own authorization checks.
  IF pg_trigger_depth() > 1 THEN
    RETURN;
  END IF;

  -- Direct authenticated journal writers need full accounting-write
  -- authority, not merely membership of the business.
  PERFORM public.finza_assert_accounting_write_authorized(
    p_business_id,
    'professional'
  );
END;
$$;

COMMENT ON FUNCTION public.finza_assert_ledger_write_authorized(UUID) IS
  'Rejects anonymous ledger writes and requires business access, write entitlement, minimum tier, non-readonly owner/admin/accountant authority and accounting.view for direct authenticated inserts. Trigger-driven and service-role postings are preserved.';

REVOKE ALL ON FUNCTION public.finza_assert_ledger_write_authorized(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finza_assert_ledger_write_authorized(UUID)
  TO service_role, postgres;

-- ----------------------------------------------------------------------------
-- 2) post_journal_entry: reject anonymous direct calls and actor spoofing
-- ----------------------------------------------------------------------------
-- The full 17-argument body is replaced below; the guard is changed so that
-- a NULL auth.uid() no longer skips authorization. Direct authenticated
-- callers may not supply another user's actor UUID.
--
-- The 10- and 14-argument wrappers are retained for legitimate manual
-- postings and force posting_source = 'accountant'.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 3) post_journal_entry_with_request_metadata: internal-only
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_journal_entry_with_request_metadata(
  p_business_id uuid,
  p_date date,
  p_description text,
  p_reference_type text,
  p_reference_id uuid,
  p_lines jsonb,
  p_is_adjustment boolean,
  p_adjustment_reason text,
  p_adjustment_ref text,
  p_created_by uuid,
  p_entry_type text,
  p_backfill_reason text,
  p_backfill_actor text,
  p_posted_by_accountant_id uuid,
  p_posting_source text,
  p_is_revenue_correction boolean,
  p_reverses_entry_id uuid,
  p_request_ip text,
  p_request_user_agent text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  -- This wrapper accepts a caller-supplied actor UUID and rewrites the JWT
  -- subject. It must only be invoked by trusted service-role/internal code.
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'LEDGER_METADATA_POSTING_FORBIDDEN: internal service-role execution is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_created_by IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', p_created_by::text, true);
  END IF;
  PERFORM set_config('finza.request_ip', COALESCE(BTRIM(p_request_ip), ''), true);
  PERFORM set_config('finza.request_user_agent', COALESCE(BTRIM(p_request_user_agent), ''), true);

  RETURN public.post_journal_entry(
    p_business_id,
    p_date,
    p_description,
    p_reference_type,
    p_reference_id,
    p_lines,
    p_is_adjustment,
    p_adjustment_reason,
    p_adjustment_ref,
    p_created_by,
    p_entry_type,
    p_backfill_reason,
    p_backfill_actor,
    p_posted_by_accountant_id,
    p_posting_source,
    p_is_revenue_correction,
    p_reverses_entry_id
  );
END;
$function$;

COMMENT ON FUNCTION public.post_journal_entry_with_request_metadata(
  uuid, date, text, text, uuid, jsonb, boolean, text, text, uuid,
  text, text, text, uuid, text, boolean, uuid, text, text
) IS
  'Internal service-role-only journal wrapper. Rejects client roles because it accepts a caller-supplied actor UUID.';

-- ----------------------------------------------------------------------------
-- 4) post_wht_remittance_to_ledger: internal-only, idempotent, safe search_path
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_wht_remittance_to_ledger(
  p_remittance_id UUID,
  p_payment_account_code TEXT DEFAULT '1010'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_remittance  public.wht_remittances%ROWTYPE;
  v_business_id UUID;
  v_je_id       UUID;
  v_wht_acc_id  UUID;
  v_cash_acc_id UUID;
BEGIN
  SELECT *
  INTO v_remittance
  FROM public.wht_remittances
  WHERE id = p_remittance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WHT remittance % not found', p_remittance_id;
  END IF;

  -- Idempotency: a remittance already linked to a journal must never create
  -- or repoint a second journal.
  IF v_remittance.journal_entry_id IS NOT NULL THEN
    RETURN v_remittance.journal_entry_id;
  END IF;

  v_business_id := v_remittance.business_id;

  SELECT id INTO v_wht_acc_id
  FROM public.accounts
  WHERE business_id = v_business_id
    AND code = '2150'
    AND deleted_at IS NULL;

  SELECT id INTO v_cash_acc_id
  FROM public.accounts
  WHERE business_id = v_business_id
    AND code = p_payment_account_code
    AND deleted_at IS NULL;

  IF v_wht_acc_id IS NULL THEN
    RAISE EXCEPTION 'WHT Payable account (2150) not found for business %', v_business_id;
  END IF;
  IF v_cash_acc_id IS NULL THEN
    RAISE EXCEPTION 'Payment account (%) not found for business %',
      p_payment_account_code, v_business_id;
  END IF;

  SELECT public.post_journal_entry(
    p_business_id    => v_business_id,
    p_date           => v_remittance.remittance_date,
    p_description    => 'WHT Remittance to GRA'
                        || COALESCE(' – ' || v_remittance.reference, ''),
    p_reference_type => 'wht_remittance',
    p_reference_id   => p_remittance_id,
    p_lines          => jsonb_build_array(
      jsonb_build_object(
        'account_id',  v_wht_acc_id,
        'debit',       v_remittance.amount,
        'description', 'WHT remitted to GRA — clears WHT Payable (2150)'
      ),
      jsonb_build_object(
        'account_id',  v_cash_acc_id,
        'credit',      v_remittance.amount,
        'description', 'Payment to GRA for withholding tax'
      )
    ),
    p_posting_source => 'system'
  ) INTO v_je_id;

  UPDATE public.wht_remittances
  SET journal_entry_id = v_je_id
  WHERE id = p_remittance_id
    AND journal_entry_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WHT_REMITTANCE_ALREADY_LINKED: remittance % was linked concurrently', p_remittance_id;
  END IF;

  RETURN v_je_id;
END;
$function$;

COMMENT ON FUNCTION public.post_wht_remittance_to_ledger(UUID, TEXT) IS
  'Internal-only WHT ledger writer. Locks the remittance row, returns an existing linked journal, and never creates or repoints a duplicate.';

-- ----------------------------------------------------------------------------
-- 5) Full post_journal_entry body with the hardened direct-call guard
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_journal_entry(p_business_id uuid, p_date date, p_description text, p_reference_type text, p_reference_id uuid, p_lines jsonb, p_is_adjustment boolean DEFAULT false, p_adjustment_reason text DEFAULT NULL::text, p_adjustment_ref text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid, p_entry_type text DEFAULT NULL::text, p_backfill_reason text DEFAULT NULL::text, p_backfill_actor text DEFAULT NULL::text, p_posted_by_accountant_id uuid DEFAULT NULL::uuid, p_posting_source text DEFAULT NULL::text, p_is_revenue_correction boolean DEFAULT false, p_reverses_entry_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
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
  -- Direct (non-trigger, non-service-role) calls must be authenticated and
  -- authorized. A NULL auth.uid() no longer skips this check, so anonymous
  -- callers are rejected even from a privileged database session.
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND pg_trigger_depth() = 0 THEN
    -- A direct database session with no application JWT is a trusted
    -- migration/job context (the same trust boundary used by the table guard).
    IF COALESCE(auth.role(), '') = ''
       AND auth.uid() IS NULL
       AND session_user IN ('postgres', 'supabase_admin') THEN
      NULL;
    ELSE
      PERFORM public.finza_assert_direct_journal_write_authorized(p_business_id);

      -- Direct callers cannot spoof the actor identity. Internal service-role
      -- and trigger-driven callers are not subject to these parameter checks.
      IF p_created_by IS NOT NULL AND p_created_by <> auth.uid() THEN
        RAISE EXCEPTION 'LEDGER_POSTING_ACTOR_FORBIDDEN: p_created_by must match the authenticated user for direct posting'
          USING ERRCODE = '42501';
      END IF;
      IF p_posted_by_accountant_id IS NOT NULL
         AND p_posted_by_accountant_id <> auth.uid() THEN
        RAISE EXCEPTION 'LEDGER_POSTING_ACTOR_FORBIDDEN: p_posted_by_accountant_id must match the authenticated user for direct posting'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- Tenant isolation: every line account must belong to the posting business.
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    account_id := NULLIF(line->>'account_id', '')::UUID;
    IF account_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.accounts a
      WHERE a.id = account_id
        AND a.business_id = p_business_id
        AND a.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'LEDGER_POSTING_ACCOUNT_INVALID: account % does not belong to business %',
        account_id, p_business_id
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

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
$function$;

-- ----------------------------------------------------------------------------
-- 6) Retain the manual-posting wrappers with safe search paths
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_journal_entry(
  p_business_id uuid,
  p_date date,
  p_description text,
  p_reference_type text,
  p_reference_id uuid,
  p_lines jsonb,
  p_is_adjustment boolean,
  p_adjustment_reason text,
  p_adjustment_ref text,
  p_created_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $function$
BEGIN
  RETURN public.post_journal_entry(
    p_business_id => p_business_id,
    p_date => p_date,
    p_description => p_description,
    p_reference_type => p_reference_type,
    p_reference_id => p_reference_id,
    p_lines => p_lines,
    p_is_adjustment => p_is_adjustment,
    p_adjustment_reason => p_adjustment_reason,
    p_adjustment_ref => p_adjustment_ref,
    p_created_by => p_created_by,
    p_entry_type => NULL::TEXT,
    p_backfill_reason => NULL::TEXT,
    p_backfill_actor => NULL::TEXT,
    p_posted_by_accountant_id => NULL::UUID,
    p_posting_source => 'accountant'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_journal_entry(
  p_business_id uuid,
  p_date date,
  p_description text,
  p_reference_type text,
  p_reference_id uuid,
  p_lines jsonb,
  p_is_adjustment boolean DEFAULT false,
  p_adjustment_reason text DEFAULT NULL::text,
  p_adjustment_ref text DEFAULT NULL::text,
  p_created_by uuid DEFAULT NULL::uuid,
  p_entry_type text DEFAULT NULL::text,
  p_backfill_reason text DEFAULT NULL::text,
  p_backfill_actor text DEFAULT NULL::text,
  p_posted_by_accountant_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $function$
BEGIN
  RETURN public.post_journal_entry(
    p_business_id => p_business_id,
    p_date => p_date,
    p_description => p_description,
    p_reference_type => p_reference_type,
    p_reference_id => p_reference_id,
    p_lines => p_lines,
    p_is_adjustment => p_is_adjustment,
    p_adjustment_reason => p_adjustment_reason,
    p_adjustment_ref => p_adjustment_ref,
    p_created_by => p_created_by,
    p_entry_type => p_entry_type,
    p_backfill_reason => p_backfill_reason,
    p_backfill_actor => p_backfill_actor,
    p_posted_by_accountant_id => p_posted_by_accountant_id,
    p_posting_source => 'accountant',
    p_is_revenue_correction => FALSE
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 7) Explicit function grants
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_sig TEXT;
  v_client_callable TEXT[] := ARRAY[
    'public.post_journal_entry(uuid,date,text,text,uuid,jsonb,boolean,text,text,uuid,text,text,text,uuid,text,boolean,uuid)',
    'public.post_journal_entry(uuid,date,text,text,uuid,jsonb,boolean,text,text,uuid,text,text,text,uuid)',
    'public.post_journal_entry(uuid,date,text,text,uuid,jsonb,boolean,text,text,uuid)',
    'public.post_adjustment_to_ledger(uuid,date,jsonb,text,uuid)',
    'public.post_asset_disposal_to_ledger(uuid,numeric,uuid)',
    'public.post_asset_purchase_to_ledger(uuid,uuid)',
    'public.post_depreciation_to_ledger(uuid)',
    'public.post_manual_journal_draft_to_ledger(uuid,uuid)',
    'public.post_opening_balance_import_to_ledger(uuid,uuid)',
    'public.post_opening_balance_to_ledger(uuid,date,jsonb,uuid,text)',
    'public.post_payroll_obligation_payment_to_ledger(uuid)',
    'public.post_payroll_to_ledger(uuid)',
    'public.post_reconciliation_journal_entry(uuid,uuid,text,date,text,jsonb,uuid,uuid,text)',
    'public.post_salary_advance_direct_repayment(uuid,uuid,numeric,uuid,date,text,text,uuid)',
    'public.post_service_intent_to_ledger(uuid,date,jsonb,uuid)',
    'public.post_service_intent_to_ledger_idempotent(uuid,date,jsonb,uuid,text)',
    'public.post_service_job_material_usage_to_ledger(uuid)',
    'public.post_service_manual_journal_draft(uuid)',
    'public.post_cit_payment_to_ledger(uuid,text,date,text)',
    'public.post_cit_provision_to_ledger(uuid)',
    'public.repost_expense_to_ledger(uuid)',
    'public.reverse_payroll_payment_atomic(uuid,uuid,date,text)',
    'public.reverse_payroll_run_atomic(uuid,uuid,date,text,boolean)',
    'public.reverse_service_job_cogs(uuid)',
    'public.reverse_service_manual_journal_with_request_metadata(uuid,date,text,uuid,text,text)',
    'public.return_service_job_material_usage(uuid,uuid,date,text,uuid)',
    'public.create_loan_with_drawdown(uuid,uuid,date,jsonb,text,numeric,text)',
    'public.approve_payroll_run_atomic(uuid,uuid)',
    'public.create_payroll_export_snapshots_for_approval(uuid,uuid,uuid)',
    'public.sync_payroll_obligations_for_approval(uuid,uuid)',
    'public.post_vat_return_payment_atomic(uuid,date,uuid,text)',
    'public.reverse_vat_return_payment(uuid,date,text,text)',
    'public.create_wht_remittance_atomic(uuid,uuid[],date,text,text,text)'
  ];
  v_internal_only TEXT[] := ARRAY[
    'public.post_journal_entry_with_request_metadata(uuid,date,text,text,uuid,jsonb,boolean,text,text,uuid,text,text,text,uuid,text,boolean,uuid,text,text)',
    'public.post_wht_remittance_to_ledger(uuid,text)',
    'public._post_payroll_payment_journal_internal(uuid,uuid,uuid,date,numeric,uuid,date)',
    'public.reverse_payroll_paystack_transfer_atomic(uuid,text,text,boolean)',
    'public.settle_payroll_paystack_transfer_atomic(uuid,text,text,text,timestamp with time zone,bigint)',
    'public.reverse_service_manual_journal(uuid,date,text)',
    'public.finza_reverse_duplicate_payroll_journal(uuid,text)',
    'public.finza_cleanup_payroll_duplicate_approval_journals()',
    'public.repair_orphan_invoice_payment_journals(uuid,integer,text)',
    'public.audit_journal_reversal_changes()',
    'public.enforce_single_journal_reversal()',
    'public.finza_enforce_ledger_insert_authorized()',
    'public.link_service_manual_draft_reversal_on_insert()',
    'public.trg_enqueue_snapshot_refresh_from_journal()',
    'public.prevent_invalid_vat_return_status_transition()',
    'public.prevent_vat_return_period_overlap()',
    'public.prevent_vat_paid_without_journal()'
  ];
BEGIN
  FOREACH v_sig IN ARRAY v_client_callable LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_sig);
  END LOOP;

  FOREACH v_sig IN ARRAY v_internal_only LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.post_journal_entry(
  uuid, date, text, text, uuid, jsonb, boolean, text, text, uuid,
  text, text, text, uuid, text, boolean, uuid
) IS
  'Canonical ledger writer. Direct non-service-role calls require authentication, full direct-journal authority and actor identity matching; anonymous calls are rejected. Trigger-driven and service-role postings are preserved.';
