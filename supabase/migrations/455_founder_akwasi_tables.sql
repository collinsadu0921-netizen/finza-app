-- ============================================================================
-- Founder-only tables for Akwasi (private founder AI command center).
-- RLS enabled with explicit deny policies for anon/authenticated.
-- Next.js /api/founder/akwasi/* routes verify founder access then use service role.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.founder_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  content text NOT NULL CHECK (length(trim(content)) > 0),
  source_type text NULL,
  source_date date NULL,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  created_by uuid NULL REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_founder_notes_created_at
  ON public.founder_notes (created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_founder_notes_deleted_at
  ON public.founder_notes (deleted_at);

CREATE TABLE IF NOT EXISTS public.founder_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  description text NULL,
  area text NOT NULL CHECK (area IN (
    'product', 'sales', 'partnership', 'website', 'payments', 'e_vat',
    'support', 'strategy', 'technical', 'finance', 'operations'
  )),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN (
    'not_started', 'in_progress', 'waiting', 'blocked', 'completed', 'cancelled'
  )),
  due_date date NULL,
  source_note_id uuid NULL REFERENCES public.founder_notes (id) ON DELETE SET NULL,
  created_by uuid NULL REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_founder_tasks_status_area
  ON public.founder_tasks (status, area) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_founder_tasks_priority
  ON public.founder_tasks (priority) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_founder_tasks_due_date
  ON public.founder_tasks (due_date) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.founder_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision text NOT NULL CHECK (length(trim(decision)) > 0),
  reason text NULL,
  area text NOT NULL CHECK (area IN (
    'product', 'sales', 'partnership', 'website', 'payments', 'e_vat',
    'support', 'strategy', 'technical', 'finance', 'operations'
  )),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'superseded')),
  created_by uuid NULL REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_founder_decisions_status
  ON public.founder_decisions (status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.founder_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_date date NOT NULL DEFAULT (CURRENT_DATE),
  summary text NOT NULL CHECK (length(trim(summary)) > 0),
  priorities jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NULL REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_founder_briefings_date
  ON public.founder_briefings (briefing_date DESC, created_at DESC);

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.founder_notes_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_founder_notes_updated_at ON public.founder_notes;
CREATE TRIGGER trg_founder_notes_updated_at
  BEFORE UPDATE ON public.founder_notes
  FOR EACH ROW EXECUTE FUNCTION public.founder_notes_set_updated_at();

CREATE OR REPLACE FUNCTION public.founder_tasks_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_founder_tasks_updated_at ON public.founder_tasks;
CREATE TRIGGER trg_founder_tasks_updated_at
  BEFORE UPDATE ON public.founder_tasks
  FOR EACH ROW EXECUTE FUNCTION public.founder_tasks_set_updated_at();

CREATE OR REPLACE FUNCTION public.founder_decisions_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_founder_decisions_updated_at ON public.founder_decisions;
CREATE TRIGGER trg_founder_decisions_updated_at
  BEFORE UPDATE ON public.founder_decisions
  FOR EACH ROW EXECUTE FUNCTION public.founder_decisions_set_updated_at();

COMMENT ON TABLE public.founder_notes IS 'Founder-only notes for Akwasi; no tenant access. API uses service role after founder session check.';
COMMENT ON TABLE public.founder_tasks IS 'Founder-only tasks for Akwasi; no tenant access.';
COMMENT ON TABLE public.founder_decisions IS 'Founder-only decision log for Akwasi; no tenant access.';
COMMENT ON TABLE public.founder_briefings IS 'Founder-only daily briefings generated by Akwasi; no tenant access.';

-- Row level security: explicit deny for anon and authenticated (service_role bypasses RLS).
ALTER TABLE public.founder_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.founder_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.founder_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.founder_briefings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS founder_notes_deny_all_authenticated ON public.founder_notes;
CREATE POLICY founder_notes_deny_all_authenticated
  ON public.founder_notes FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS founder_notes_deny_all_anon ON public.founder_notes;
CREATE POLICY founder_notes_deny_all_anon
  ON public.founder_notes FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS founder_tasks_deny_all_authenticated ON public.founder_tasks;
CREATE POLICY founder_tasks_deny_all_authenticated
  ON public.founder_tasks FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS founder_tasks_deny_all_anon ON public.founder_tasks;
CREATE POLICY founder_tasks_deny_all_anon
  ON public.founder_tasks FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS founder_decisions_deny_all_authenticated ON public.founder_decisions;
CREATE POLICY founder_decisions_deny_all_authenticated
  ON public.founder_decisions FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS founder_decisions_deny_all_anon ON public.founder_decisions;
CREATE POLICY founder_decisions_deny_all_anon
  ON public.founder_decisions FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS founder_briefings_deny_all_authenticated ON public.founder_briefings;
CREATE POLICY founder_briefings_deny_all_authenticated
  ON public.founder_briefings FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS founder_briefings_deny_all_anon ON public.founder_briefings;
CREATE POLICY founder_briefings_deny_all_anon
  ON public.founder_briefings FOR ALL TO anon
  USING (false) WITH CHECK (false);
