-- 722_service_job_cogs_membership_guard.sql
-- Correction to 721.
--
-- 721 required accounting-write authority for reverse_service_job_cogs. The
-- cancel route and lib/service/jobReversal.ts allow any business member to
-- cancel a service job and restore its materials, so that guard would make the
-- reversal fail after stock was already restored for staff/cashier members.
--
-- This migration keeps caller identity and tenant isolation (the original
-- cross-tenant hole) but matches the existing operational rule: an active
-- member of the job's business may reverse its COGS. Accounting-role gating
-- stays where it already exists (journal posting and period controls).

CREATE OR REPLACE FUNCTION public.reverse_service_job_cogs(p_job_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  business_id_val UUID;
  total_reversal NUMERIC;
  cost_account_id UUID;
  inventory_account_id UUID;
  journal_lines JSONB;
  journal_id UUID;
  v_date DATE;
BEGIN

  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT (auth.role() IS NULL AND session_user IN ('postgres','supabase_admin')) THEN
    IF auth.uid() IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.service_jobs sj
         WHERE sj.id = p_job_id
           AND public.finza_user_can_access_business(sj.business_id)
       ) THEN
      RAISE EXCEPTION 'Not authorized to reverse service job COGS for this business'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  -- Idempotency: already posted for this job cancel
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'service_job_cancel' AND reference_id = p_job_id
  LIMIT 1;
  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  SELECT business_id INTO business_id_val
  FROM service_jobs
  WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service job not found: %', p_job_id;
  END IF;

  -- Only consumed usages that still have outstanding COGS (not returned per-usage)
  SELECT COALESCE(SUM(u.total_cost), 0) INTO total_reversal
  FROM service_job_material_usage u
  WHERE u.job_id = p_job_id
    AND u.business_id = business_id_val
    AND u.status = 'consumed'
    AND u.return_movement_id IS NULL
    AND u.return_journal_entry_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM journal_entries je
      WHERE je.reference_type = 'service_job_usage'
        AND je.reference_id = u.id
    );

  IF total_reversal IS NULL OR total_reversal <= 0 THEN
    RETURN NULL;
  END IF;

  v_date := CURRENT_DATE;

  PERFORM assert_accounting_period_is_open(business_id_val, v_date);
  PERFORM assert_account_exists(business_id_val, '1450');
  PERFORM assert_account_exists(business_id_val, '5110');

  cost_account_id := get_account_by_code(business_id_val, '5110');
  inventory_account_id := get_account_by_code(business_id_val, '1450');

  IF cost_account_id IS NULL OR inventory_account_id IS NULL THEN
    RAISE EXCEPTION 'Service ledger accounts (1450, 5110) not found for business %', business_id_val;
  END IF;

  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', inventory_account_id,
      'debit', total_reversal,
      'description', 'Service job cancelled - restore materials inventory'
    ),
    jsonb_build_object(
      'account_id', cost_account_id,
      'credit', total_reversal,
      'description', 'Reverse cost of services'
    )
  );

  SELECT post_journal_entry(
    business_id_val,
    v_date,
    'Service job cancelled - reverse COGS',
    'service_job_cancel',
    p_job_id,
    journal_lines,
    FALSE,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'system'
  ) INTO journal_id;

  RETURN journal_id;
END;
$function$
;
