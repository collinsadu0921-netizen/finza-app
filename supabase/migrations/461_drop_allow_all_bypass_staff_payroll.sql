-- ============================================================================
-- Fix Phase 3 RLS: remove permissive allow_all_* policies that OR with real rules
--
-- Migration 051_fix_all_table_structures.sql enables RLS on several tables and
-- creates allow_all_select_<table> / insert / update / delete with USING (true).
-- Those policies were never dropped for public.staff, so they bypassed the
-- Professional-tier policies from 460_service_professional_tables_rls.sql.
--
-- Also drops the same pattern on payroll-adjacent tables from the same 051 loop
-- (allowances, deductions, payroll_runs, payroll_entries, payslips). Canonical
-- policies exist in 382_payroll_rls_business_members.sql — allow_all_* only
-- weakens them via OR semantics (same class of bug as staff).
--
-- Repo search: no migrations define allow_all_* on service_jobs,
-- service_job_material_usage, service_material_inventory,
-- service_material_movements, business_users, or proforma_invoices.
--
-- Verification (run after migrate):
--   SELECT tablename, policyname, cmd, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN (
--       'staff','service_jobs','service_job_material_usage',
--       'service_material_inventory','service_material_movements'
--     )
--   ORDER BY tablename, policyname;
--
--   SELECT tablename, policyname FROM pg_policies
--   WHERE schemaname = 'public'
--     AND policyname LIKE 'allow_all%'
--     AND tablename IN (
--       'staff','allowances','deductions','payroll_runs',
--       'payroll_entries','payslips'
--     );
--   -- Expect zero rows after this migration.
-- ============================================================================

-- ── staff: drop dev bypass policies ──────────────────────────────────────────
DROP POLICY IF EXISTS allow_all_select_staff ON public.staff;
DROP POLICY IF EXISTS allow_all_insert_staff ON public.staff;
DROP POLICY IF EXISTS allow_all_update_staff ON public.staff;
DROP POLICY IF EXISTS allow_all_delete_staff ON public.staff;

-- Recreate intended Professional-gated policies (idempotent with 460)
DROP POLICY IF EXISTS "Users can view staff for their business" ON public.staff;
DROP POLICY IF EXISTS "Users can insert staff for their business" ON public.staff;
DROP POLICY IF EXISTS "Users can update staff for their business" ON public.staff;
DROP POLICY IF EXISTS "Users can delete staff for their business" ON public.staff;

CREATE POLICY "Users can view staff for their business"
  ON public.staff FOR SELECT
  USING (
    public.finza_user_can_access_business(staff.business_id)
    AND public.finza_business_has_service_min_tier(staff.business_id, 'professional')
  );

CREATE POLICY "Users can insert staff for their business"
  ON public.staff FOR INSERT
  WITH CHECK (
    public.finza_user_can_access_business(staff.business_id)
    AND public.finza_business_has_service_min_tier(staff.business_id, 'professional')
  );

CREATE POLICY "Users can update staff for their business"
  ON public.staff FOR UPDATE
  USING (
    public.finza_user_can_access_business(staff.business_id)
    AND public.finza_business_has_service_min_tier(staff.business_id, 'professional')
  )
  WITH CHECK (
    public.finza_user_can_access_business(staff.business_id)
    AND public.finza_business_has_service_min_tier(staff.business_id, 'professional')
  );

CREATE POLICY "Users can delete staff for their business"
  ON public.staff FOR DELETE
  USING (
    public.finza_user_can_access_business(staff.business_id)
    AND public.finza_business_has_service_min_tier(staff.business_id, 'professional')
  );

-- ── same 051 loop: payroll-related tables (no tier helper; membership-only) ──
DROP POLICY IF EXISTS allow_all_select_allowances ON public.allowances;
DROP POLICY IF EXISTS allow_all_insert_allowances ON public.allowances;
DROP POLICY IF EXISTS allow_all_update_allowances ON public.allowances;
DROP POLICY IF EXISTS allow_all_delete_allowances ON public.allowances;

DROP POLICY IF EXISTS allow_all_select_deductions ON public.deductions;
DROP POLICY IF EXISTS allow_all_insert_deductions ON public.deductions;
DROP POLICY IF EXISTS allow_all_update_deductions ON public.deductions;
DROP POLICY IF EXISTS allow_all_delete_deductions ON public.deductions;

DROP POLICY IF EXISTS allow_all_select_payroll_runs ON public.payroll_runs;
DROP POLICY IF EXISTS allow_all_insert_payroll_runs ON public.payroll_runs;
DROP POLICY IF EXISTS allow_all_update_payroll_runs ON public.payroll_runs;
DROP POLICY IF EXISTS allow_all_delete_payroll_runs ON public.payroll_runs;

DROP POLICY IF EXISTS allow_all_select_payroll_entries ON public.payroll_entries;
DROP POLICY IF EXISTS allow_all_insert_payroll_entries ON public.payroll_entries;
DROP POLICY IF EXISTS allow_all_update_payroll_entries ON public.payroll_entries;
DROP POLICY IF EXISTS allow_all_delete_payroll_entries ON public.payroll_entries;

DROP POLICY IF EXISTS allow_all_select_payslips ON public.payslips;
DROP POLICY IF EXISTS allow_all_insert_payslips ON public.payslips;
DROP POLICY IF EXISTS allow_all_update_payslips ON public.payslips;
DROP POLICY IF EXISTS allow_all_delete_payslips ON public.payslips;
