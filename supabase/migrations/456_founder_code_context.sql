-- ============================================================================
-- founder_code_context: Cursor / implementation summaries for Akwasi (founder-only).
-- Same RLS pattern as other founder_* tables.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.founder_code_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  summary text NOT NULL CHECK (length(trim(summary)) > 0),
  related_area text NULL CHECK (
    related_area IS NULL OR related_area IN (
      'product', 'sales', 'partnership', 'website', 'payments', 'e_vat',
      'support', 'strategy', 'technical', 'finance', 'operations'
    )
  ),
  file_paths text[] NOT NULL DEFAULT '{}'::text[],
  source_type text NOT NULL DEFAULT 'cursor_summary',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_founder_code_context_created_at
  ON public.founder_code_context (created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_founder_code_context_related_area
  ON public.founder_code_context (related_area) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.founder_code_context_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_founder_code_context_updated_at ON public.founder_code_context;
CREATE TRIGGER trg_founder_code_context_updated_at
  BEFORE UPDATE ON public.founder_code_context
  FOR EACH ROW EXECUTE FUNCTION public.founder_code_context_set_updated_at();

COMMENT ON TABLE public.founder_code_context IS 'Founder-only implementation/code summaries for Akwasi; no tenant access.';

ALTER TABLE public.founder_code_context ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS founder_code_context_deny_all_authenticated ON public.founder_code_context;
CREATE POLICY founder_code_context_deny_all_authenticated
  ON public.founder_code_context FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS founder_code_context_deny_all_anon ON public.founder_code_context;
CREATE POLICY founder_code_context_deny_all_anon
  ON public.founder_code_context FOR ALL TO anon
  USING (false) WITH CHECK (false);
