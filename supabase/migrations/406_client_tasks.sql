-- ============================================================================
-- client_tasks: internal task queue per client (firm workspace)
-- Supports status workflow, priority, assignment, and due dates.
-- No subtasks, no comments, no recurring tasks in this MVP.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_tasks (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id               UUID        NOT NULL
    REFERENCES public.accounting_firms(id)   ON DELETE CASCADE,
  client_business_id    UUID        NOT NULL
    REFERENCES public.businesses(id)         ON DELETE CASCADE,
  title                 TEXT        NOT NULL CHECK (length(trim(title)) > 0),
  description           TEXT        NOT NULL DEFAULT '',
  status                TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'blocked', 'completed', 'cancelled')),
  priority              TEXT        NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_to_user_id   UUID        NULL
    REFERENCES auth.users(id),
  created_by_user_id    UUID        NOT NULL
    REFERENCES auth.users(id),
  due_at                TIMESTAMPTZ NULL,
  completed_at          TIMESTAMPTZ NULL,
  metadata              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_tasks_firm_id
  ON public.client_tasks(firm_id);
CREATE INDEX IF NOT EXISTS idx_client_tasks_client_business_id
  ON public.client_tasks(client_business_id);
CREATE INDEX IF NOT EXISTS idx_client_tasks_firm_client
  ON public.client_tasks(firm_id, client_business_id);
CREATE INDEX IF NOT EXISTS idx_client_tasks_status
  ON public.client_tasks(firm_id, client_business_id, status);
CREATE INDEX IF NOT EXISTS idx_client_tasks_due_at
  ON public.client_tasks(due_at ASC NULLS LAST)
  WHERE due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_client_tasks_assigned_to
  ON public.client_tasks(assigned_to_user_id)
  WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_client_tasks_created_at
  ON public.client_tasks(created_at DESC);

CREATE OR REPLACE TRIGGER set_client_tasks_updated_at
  BEFORE UPDATE ON public.client_tasks
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

COMMENT ON TABLE public.client_tasks
  IS 'Internal task queue per client — firm workspace, no subtasks/comments/attachments in MVP';
COMMENT ON COLUMN public.client_tasks.status
  IS 'pending | in_progress | blocked | completed | cancelled';
COMMENT ON COLUMN public.client_tasks.priority
  IS 'low | normal | high | urgent';
COMMENT ON COLUMN public.client_tasks.completed_at
  IS 'Set automatically when status → completed; cleared on revert';

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.client_tasks ENABLE ROW LEVEL SECURITY;

-- SELECT: any firm member
DROP POLICY IF EXISTS "Firm members can select client_tasks"
  ON public.client_tasks;
CREATE POLICY "Firm members can select client_tasks"
  ON public.client_tasks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_tasks.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- INSERT: firm member as creator
DROP POLICY IF EXISTS "Firm members can insert client_tasks"
  ON public.client_tasks;
CREATE POLICY "Firm members can insert client_tasks"
  ON public.client_tasks FOR INSERT
  WITH CHECK (
    created_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_tasks.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- UPDATE: any firm member (collaborative task management)
DROP POLICY IF EXISTS "Firm members can update client_tasks"
  ON public.client_tasks;
CREATE POLICY "Firm members can update client_tasks"
  ON public.client_tasks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_tasks.firm_id
        AND afu.user_id = auth.uid()
    )
  );
