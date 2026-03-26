-- ============================================================================
-- client_filing_templates + client_filing_template_items
-- Reusable checklist blueprints per firm, scoped to a filing_type.
-- Applying a template bulk-creates client_filing_checklist_items on a filing.
-- ============================================================================

-- ── client_filing_templates ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_filing_templates (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id              UUID        NOT NULL
    REFERENCES public.accounting_firms(id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL CHECK (length(trim(name)) > 0),
  filing_type          TEXT        NOT NULL CHECK (length(trim(filing_type)) > 0),
  created_by_user_id   UUID        NOT NULL
    REFERENCES auth.users(id),
  metadata             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_filing_templates_firm_id
  ON public.client_filing_templates(firm_id);
CREATE INDEX IF NOT EXISTS idx_filing_templates_firm_type
  ON public.client_filing_templates(firm_id, filing_type);

CREATE OR REPLACE TRIGGER set_filing_templates_updated_at
  BEFORE UPDATE ON public.client_filing_templates
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

COMMENT ON TABLE public.client_filing_templates
  IS 'Reusable checklist blueprints scoped to a firm and filing_type';

-- ── client_filing_template_items ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_filing_template_items (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  UUID        NOT NULL
    REFERENCES public.client_filing_templates(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL CHECK (length(trim(title)) > 0),
  note         TEXT        NOT NULL DEFAULT '',
  sort_order   INT         NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_filing_template_items_template_id
  ON public.client_filing_template_items(template_id);
CREATE INDEX IF NOT EXISTS idx_filing_template_items_sort
  ON public.client_filing_template_items(template_id, sort_order ASC);

CREATE OR REPLACE TRIGGER set_filing_template_items_updated_at
  BEFORE UPDATE ON public.client_filing_template_items
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

COMMENT ON TABLE public.client_filing_template_items
  IS 'Checklist item definitions within a filing template; sort_order controls display order';

-- ── RLS: client_filing_templates ─────────────────────────────────────────────

ALTER TABLE public.client_filing_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Firm members can select filing_templates"
  ON public.client_filing_templates;
CREATE POLICY "Firm members can select filing_templates"
  ON public.client_filing_templates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_filing_templates.firm_id
        AND afu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Firm members can insert filing_templates"
  ON public.client_filing_templates;
CREATE POLICY "Firm members can insert filing_templates"
  ON public.client_filing_templates FOR INSERT
  WITH CHECK (
    created_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_filing_templates.firm_id
        AND afu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Firm members can update filing_templates"
  ON public.client_filing_templates;
CREATE POLICY "Firm members can update filing_templates"
  ON public.client_filing_templates FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_filing_templates.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- ── RLS: client_filing_template_items ────────────────────────────────────────
-- Access is derived from the parent template's firm membership — no firm_id column needed.

ALTER TABLE public.client_filing_template_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Firm members can select template_items"
  ON public.client_filing_template_items;
CREATE POLICY "Firm members can select template_items"
  ON public.client_filing_template_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.client_filing_templates t
      JOIN public.accounting_firm_users afu ON afu.firm_id = t.firm_id
      WHERE t.id = client_filing_template_items.template_id
        AND afu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Firm members can insert template_items"
  ON public.client_filing_template_items;
CREATE POLICY "Firm members can insert template_items"
  ON public.client_filing_template_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.client_filing_templates t
      JOIN public.accounting_firm_users afu ON afu.firm_id = t.firm_id
      WHERE t.id = client_filing_template_items.template_id
        AND afu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Firm members can update template_items"
  ON public.client_filing_template_items;
CREATE POLICY "Firm members can update template_items"
  ON public.client_filing_template_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.client_filing_templates t
      JOIN public.accounting_firm_users afu ON afu.firm_id = t.firm_id
      WHERE t.id = client_filing_template_items.template_id
        AND afu.user_id = auth.uid()
    )
  );
