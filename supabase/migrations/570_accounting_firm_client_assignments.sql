-- ============================================================================
-- Staff ↔ client assignments for Practice portfolio authorization.
-- Staging-safe additive table. Does not alter engagements or access_level.
--
-- Transition: application treats a firm with ZERO assignment rows as
-- compatibility mode (pre-P1B firm-wide visibility). The first assignment
-- row turns enforcement on for restricted roles.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.accounting_firm_client_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES public.accounting_firms(id) ON DELETE CASCADE,
  client_business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by_user_id UUID NOT NULL REFERENCES auth.users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT accounting_firm_client_assignments_dates_check
    CHECK (unassigned_at IS NULL OR unassigned_at >= assigned_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_afca_one_active
  ON public.accounting_firm_client_assignments (firm_id, client_business_id, user_id)
  WHERE unassigned_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_afca_firm_id
  ON public.accounting_firm_client_assignments (firm_id);
CREATE INDEX IF NOT EXISTS idx_afca_firm_user_active
  ON public.accounting_firm_client_assignments (firm_id, user_id)
  WHERE unassigned_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_afca_firm_client_active
  ON public.accounting_firm_client_assignments (firm_id, client_business_id)
  WHERE unassigned_at IS NULL;

COMMENT ON TABLE public.accounting_firm_client_assignments IS
  'Practice staff-to-client assignments. Separate from firm_client_engagements.';
COMMENT ON COLUMN public.accounting_firm_client_assignments.unassigned_at IS
  'NULL = active assignment. Set to unassign without deleting the engagement.';

CREATE OR REPLACE FUNCTION public.update_afca_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_afca_updated_at ON public.accounting_firm_client_assignments;
CREATE TRIGGER trigger_update_afca_updated_at
  BEFORE UPDATE ON public.accounting_firm_client_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_afca_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_afca_same_firm_and_engagement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.accounting_firm_users afu
    WHERE afu.firm_id = NEW.firm_id
      AND afu.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Assignment user must belong to the same firm';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.firm_client_engagements e
    WHERE e.accounting_firm_id = NEW.firm_id
      AND e.client_business_id = NEW.client_business_id
      AND e.status IN ('pending', 'accepted', 'active', 'suspended')
  ) THEN
    RAISE EXCEPTION 'Assignment requires a valid firm-client engagement';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enforce_afca_same_firm_and_engagement
  ON public.accounting_firm_client_assignments;
CREATE TRIGGER trigger_enforce_afca_same_firm_and_engagement
  BEFORE INSERT OR UPDATE OF firm_id, client_business_id, user_id, unassigned_at
  ON public.accounting_firm_client_assignments
  FOR EACH ROW
  WHEN (NEW.unassigned_at IS NULL)
  EXECUTE FUNCTION public.enforce_afca_same_firm_and_engagement();

ALTER TABLE public.accounting_firm_client_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Firm members can select assignments" ON public.accounting_firm_client_assignments;
CREATE POLICY "Firm members can select assignments"
  ON public.accounting_firm_client_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = accounting_firm_client_assignments.firm_id
        AND afu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Partners can insert assignments" ON public.accounting_firm_client_assignments;
CREATE POLICY "Partners can insert assignments"
  ON public.accounting_firm_client_assignments FOR INSERT
  WITH CHECK (
    assigned_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = accounting_firm_client_assignments.firm_id
        AND afu.user_id = auth.uid()
        AND afu.role = 'partner'
    )
  );

DROP POLICY IF EXISTS "Partners can update assignments" ON public.accounting_firm_client_assignments;
CREATE POLICY "Partners can update assignments"
  ON public.accounting_firm_client_assignments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = accounting_firm_client_assignments.firm_id
        AND afu.user_id = auth.uid()
        AND afu.role = 'partner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = accounting_firm_client_assignments.firm_id
        AND afu.user_id = auth.uid()
        AND afu.role = 'partner'
    )
  );

DROP POLICY IF EXISTS "Partners can delete assignments" ON public.accounting_firm_client_assignments;
CREATE POLICY "Partners can delete assignments"
  ON public.accounting_firm_client_assignments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = accounting_firm_client_assignments.firm_id
        AND afu.user_id = auth.uid()
        AND afu.role = 'partner'
    )
  );

-- Tighten activity-log INSERT only when the table exists.
-- Staging may not have migration 144; assignment writes still call logFirmActivity
-- (soft-fail). Creating a second audit table is out of scope.
DO $$
BEGIN
  IF to_regclass('public.accounting_firm_activity_logs') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Allow INSERT for authenticated users" ON public.accounting_firm_activity_logs';
    EXECUTE 'DROP POLICY IF EXISTS "Firm members can insert activity logs for their firms" ON public.accounting_firm_activity_logs';
    EXECUTE $policy$
      CREATE POLICY "Firm members can insert activity logs for their firms"
        ON public.accounting_firm_activity_logs FOR INSERT
        WITH CHECK (
          actor_user_id = auth.uid()
          AND EXISTS (
            SELECT 1 FROM public.accounting_firm_users afu
            WHERE afu.firm_id = accounting_firm_activity_logs.firm_id
              AND afu.user_id = auth.uid()
          )
        )
    $policy$;
  END IF;
END $$;
