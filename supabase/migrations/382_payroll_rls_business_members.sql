-- ============================================================================
-- Payroll RLS: owner OR business_users (align with salary_advances / payments)
-- - Replaces owner-only policies on staff, allowances, deductions,
--   payroll_runs, payroll_entries, payslips.
-- - Drops unsafe "Public can view payslips by token" (public_token IS NOT NULL).
--   Public payslip access must use service-role API routes only.
-- - Adds payslips UPDATE for sent_via_* / sent_at tracking.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.finza_user_can_access_business(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = p_business_id AND b.owner_id = (SELECT auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = p_business_id AND bu.user_id = (SELECT auth.uid())
  );
$$;

COMMENT ON FUNCTION public.finza_user_can_access_business(uuid) IS
  'True if auth.uid() is the business owner or has a business_users row for the business. Used by payroll RLS.';

GRANT EXECUTE ON FUNCTION public.finza_user_can_access_business(uuid) TO authenticated;

-- ── staff ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view staff for their business" ON public.staff;
DROP POLICY IF EXISTS "Users can insert staff for their business" ON public.staff;
DROP POLICY IF EXISTS "Users can update staff for their business" ON public.staff;
DROP POLICY IF EXISTS "Users can delete staff for their business" ON public.staff;

CREATE POLICY "Users can view staff for their business"
  ON public.staff FOR SELECT
  USING (public.finza_user_can_access_business(staff.business_id));

CREATE POLICY "Users can insert staff for their business"
  ON public.staff FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(staff.business_id));

CREATE POLICY "Users can update staff for their business"
  ON public.staff FOR UPDATE
  USING (public.finza_user_can_access_business(staff.business_id))
  WITH CHECK (public.finza_user_can_access_business(staff.business_id));

CREATE POLICY "Users can delete staff for their business"
  ON public.staff FOR DELETE
  USING (public.finza_user_can_access_business(staff.business_id));

-- ── allowances ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can manage allowances for their business staff" ON public.allowances;

CREATE POLICY "Users can manage allowances for their business staff"
  ON public.allowances FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = allowances.staff_id
        AND public.finza_user_can_access_business(s.business_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = allowances.staff_id
        AND public.finza_user_can_access_business(s.business_id)
    )
  );

-- ── deductions ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can manage deductions for their business staff" ON public.deductions;

CREATE POLICY "Users can manage deductions for their business staff"
  ON public.deductions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = deductions.staff_id
        AND public.finza_user_can_access_business(s.business_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = deductions.staff_id
        AND public.finza_user_can_access_business(s.business_id)
    )
  );

-- ── payroll_runs ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view payroll runs for their business" ON public.payroll_runs;
DROP POLICY IF EXISTS "Users can insert payroll runs for their business" ON public.payroll_runs;
DROP POLICY IF EXISTS "Users can update payroll runs for their business" ON public.payroll_runs;

CREATE POLICY "Users can view payroll runs for their business"
  ON public.payroll_runs FOR SELECT
  USING (public.finza_user_can_access_business(payroll_runs.business_id));

CREATE POLICY "Users can insert payroll runs for their business"
  ON public.payroll_runs FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(payroll_runs.business_id));

CREATE POLICY "Users can update payroll runs for their business"
  ON public.payroll_runs FOR UPDATE
  USING (public.finza_user_can_access_business(payroll_runs.business_id))
  WITH CHECK (public.finza_user_can_access_business(payroll_runs.business_id));

-- ── payroll_entries ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view payroll entries for their business" ON public.payroll_entries;
DROP POLICY IF EXISTS "Users can insert payroll entries for their business" ON public.payroll_entries;

CREATE POLICY "Users can view payroll entries for their business"
  ON public.payroll_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.payroll_runs pr
      WHERE pr.id = payroll_entries.payroll_run_id
        AND public.finza_user_can_access_business(pr.business_id)
    )
  );

CREATE POLICY "Users can insert payroll entries for their business"
  ON public.payroll_entries FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.payroll_runs pr
      WHERE pr.id = payroll_entries.payroll_run_id
        AND public.finza_user_can_access_business(pr.business_id)
    )
  );

-- ── payslips ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view payslips for their business" ON public.payslips;
DROP POLICY IF EXISTS "Public can view payslips by token" ON public.payslips;
DROP POLICY IF EXISTS "Users can insert payslips for their business" ON public.payslips;

CREATE POLICY "Users can view payslips for their business"
  ON public.payslips FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.payroll_runs pr
      WHERE pr.id = payslips.payroll_run_id
        AND public.finza_user_can_access_business(pr.business_id)
    )
  );

CREATE POLICY "Users can insert payslips for their business"
  ON public.payslips FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.payroll_runs pr
      WHERE pr.id = payslips.payroll_run_id
        AND public.finza_user_can_access_business(pr.business_id)
    )
  );

CREATE POLICY "Users can update payslips for their business"
  ON public.payslips FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.payroll_runs pr
      WHERE pr.id = payslips.payroll_run_id
        AND public.finza_user_can_access_business(pr.business_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.payroll_runs pr
      WHERE pr.id = payslips.payroll_run_id
        AND public.finza_user_can_access_business(pr.business_id)
    )
  );
