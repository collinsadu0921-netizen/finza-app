-- ============================================================================
-- Forward-only: ensure current accounting_firm_activity_logs schema + RLS.
-- Does not rewrite historical migration 144.
-- Staging never received 144; production may already have the table (396 relaxed CHECKs).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.accounting_firm_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES public.accounting_firms(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id),
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.accounting_firm_activity_logs
  DROP CONSTRAINT IF EXISTS accounting_firm_activity_logs_action_type_check;
ALTER TABLE public.accounting_firm_activity_logs
  DROP CONSTRAINT IF EXISTS accounting_firm_activity_logs_entity_type_check;
ALTER TABLE public.accounting_firm_activity_logs
  DROP CONSTRAINT IF EXISTS accounting_firm_activity_logs_action_type_nonempty;
ALTER TABLE public.accounting_firm_activity_logs
  DROP CONSTRAINT IF EXISTS accounting_firm_activity_logs_entity_type_nonempty;

ALTER TABLE public.accounting_firm_activity_logs
  ADD CONSTRAINT accounting_firm_activity_logs_action_type_nonempty
  CHECK (length(trim(action_type)) > 0);
ALTER TABLE public.accounting_firm_activity_logs
  ADD CONSTRAINT accounting_firm_activity_logs_entity_type_nonempty
  CHECK (length(trim(entity_type)) > 0);

CREATE INDEX IF NOT EXISTS idx_accounting_firm_activity_logs_firm_id
  ON public.accounting_firm_activity_logs(firm_id);
CREATE INDEX IF NOT EXISTS idx_accounting_firm_activity_logs_created_at
  ON public.accounting_firm_activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_accounting_firm_activity_logs_firm_created_at
  ON public.accounting_firm_activity_logs(firm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_firm_activity_logs_actor_user_id
  ON public.accounting_firm_activity_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_accounting_firm_activity_logs_action_type
  ON public.accounting_firm_activity_logs(action_type);

COMMENT ON TABLE public.accounting_firm_activity_logs IS
  'Append-only firm activity audit trail. Current schema (non-enumerated action/entity types).';

ALTER TABLE public.accounting_firm_activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Firm members can view activity logs for their firms"
  ON public.accounting_firm_activity_logs;
CREATE POLICY "Firm members can view activity logs for their firms"
  ON public.accounting_firm_activity_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = accounting_firm_activity_logs.firm_id
        AND afu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Allow INSERT for authenticated users"
  ON public.accounting_firm_activity_logs;
DROP POLICY IF EXISTS "Firm members can insert activity logs for their firms"
  ON public.accounting_firm_activity_logs;
CREATE POLICY "Firm members can insert activity logs for their firms"
  ON public.accounting_firm_activity_logs FOR INSERT
  WITH CHECK (
    actor_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = accounting_firm_activity_logs.firm_id
        AND afu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Prevent UPDATE on activity logs" ON public.accounting_firm_activity_logs;
CREATE POLICY "Prevent UPDATE on activity logs"
  ON public.accounting_firm_activity_logs FOR UPDATE
  USING (false);

DROP POLICY IF EXISTS "Prevent DELETE on activity logs" ON public.accounting_firm_activity_logs;
CREATE POLICY "Prevent DELETE on activity logs"
  ON public.accounting_firm_activity_logs FOR DELETE
  USING (false);
