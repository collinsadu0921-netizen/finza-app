-- ============================================================================
-- Phase 1: Ghana dynamic tax schedules + GRA E-VAT levy metadata (foundation)
-- ============================================================================
-- No invoice calculation, UI, ledger, reporting, or E-VAT submission changes.
-- Seeds metadata only; rate_percent is NULL everywhere.
-- ============================================================================

-- ── tax_schedules ───────────────────────────────────────────────────────────
CREATE TABLE public.tax_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses (id) ON DELETE CASCADE,
  jurisdiction text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_schedules_effective_dates_check CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  )
);

COMMENT ON TABLE public.tax_schedules IS 'Versioned tax schedule headers (GH and future jurisdictions). Phase 1: metadata only.';
COMMENT ON COLUMN public.tax_schedules.business_id IS 'NULL = system-wide schedule shared by all businesses.';
COMMENT ON COLUMN public.tax_schedules.effective_from IS 'Schedule starts; does not imply legal rate validity dates for seeded rows.';

CREATE UNIQUE INDEX tax_schedules_system_unique
  ON public.tax_schedules (jurisdiction, code, effective_from)
  WHERE business_id IS NULL;

CREATE UNIQUE INDEX tax_schedules_tenant_unique
  ON public.tax_schedules (business_id, jurisdiction, code, effective_from)
  WHERE business_id IS NOT NULL;

CREATE INDEX tax_schedules_jurisdiction_lookup
  ON public.tax_schedules (jurisdiction, effective_from)
  WHERE business_id IS NULL;

-- ── tax_schedule_lines ─────────────────────────────────────────────────────
CREATE TABLE public.tax_schedule_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_schedule_id uuid NOT NULL REFERENCES public.tax_schedules (id) ON DELETE CASCADE,
  sort_order integer NOT NULL,
  internal_code text NOT NULL,
  gra_levy_slot char(1),
  gra_field_name text,
  display_label text NOT NULL,
  display_description text,
  classification text NOT NULL,
  calculation_basis text NOT NULL DEFAULT 'unknown',
  rate_percent numeric,
  ledger_account_code text,
  include_in_total_levy boolean NOT NULL DEFAULT true,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_schedule_lines_gra_slot_check CHECK (
    gra_levy_slot IS NULL OR gra_levy_slot IN ('A', 'B', 'C', 'D', 'E')
  ),
  CONSTRAINT tax_schedule_lines_classification_check CHECK (
    classification IN ('levy', 'tax', 'duty', 'fee', 'margin', 'unclear')
  ),
  UNIQUE (tax_schedule_id, internal_code)
);

COMMENT ON COLUMN public.tax_schedule_lines.gra_field_name IS 'E-VAT payload field e.g. levyAmountA.';
COMMENT ON COLUMN public.tax_schedule_lines.rate_percent IS 'NULL in Phase 1; no inferred rates seeded.';

CREATE UNIQUE INDEX tax_schedule_lines_one_slot_per_schedule
  ON public.tax_schedule_lines (tax_schedule_id, gra_levy_slot)
  WHERE gra_levy_slot IS NOT NULL;

CREATE INDEX tax_schedule_lines_schedule_sort
  ON public.tax_schedule_lines (tax_schedule_id, sort_order);

CREATE INDEX tax_schedule_lines_tax_schedule_id_idx
  ON public.tax_schedule_lines (tax_schedule_id);

-- ── product_tax_categories ────────────────────────────────────────────────────
CREATE TABLE public.product_tax_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses (id) ON DELETE CASCADE,
  jurisdiction text NOT NULL,
  code text NOT NULL,
  gra_item_category text,
  label text NOT NULL,
  description text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_tax_categories_code_not_empty CHECK (
    length(trim(code)) > 0
  )
);

COMMENT ON TABLE public.product_tax_categories IS 'Maps internal product classification codes to GRA itemCategory values.';
COMMENT ON COLUMN public.product_tax_categories.code IS 'Internal code (e.g. STANDARD); use gra_item_category for GRA string.';

CREATE UNIQUE INDEX product_tax_categories_system_unique
  ON public.product_tax_categories (jurisdiction, code)
  WHERE business_id IS NULL;

CREATE UNIQUE INDEX product_tax_categories_tenant_unique
  ON public.product_tax_categories (business_id, jurisdiction, code)
  WHERE business_id IS NOT NULL;

CREATE INDEX product_tax_categories_jurisdiction_code
  ON public.product_tax_categories (jurisdiction, code);

CREATE INDEX product_tax_categories_jurisdiction_gra_item_category
  ON public.product_tax_categories (jurisdiction, gra_item_category);

-- ── invoice_item_tax_lines ───────────────────────────────────────────────────
CREATE TABLE public.invoice_item_tax_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_item_id uuid NOT NULL REFERENCES public.invoice_items (id) ON DELETE CASCADE,
  tax_schedule_line_id uuid REFERENCES public.tax_schedule_lines (id) ON DELETE SET NULL,
  internal_code text NOT NULL,
  display_label text NOT NULL,
  classification text NOT NULL,
  gra_levy_slot char(1),
  gra_field_name text,
  calculation_basis text NOT NULL DEFAULT 'unknown',
  base_amount numeric(18, 6),
  amount numeric(18, 6) NOT NULL DEFAULT 0,
  rate_percent numeric,
  ledger_account_code text,
  include_in_total_levy boolean NOT NULL DEFAULT true,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_item_tax_lines_gra_slot_check CHECK (
    gra_levy_slot IS NULL OR gra_levy_slot IN ('A', 'B', 'C', 'D', 'E')
  ),
  CONSTRAINT invoice_item_tax_lines_classification_check CHECK (
    classification IN ('levy', 'tax', 'duty', 'fee', 'margin', 'unclear')
  )
);

COMMENT ON TABLE public.invoice_item_tax_lines IS 'Line-level tax/levy components; Phase 1 empty until a future release populates.';
COMMENT ON COLUMN public.invoice_item_tax_lines.amount IS 'Charged component amount';

CREATE INDEX invoice_item_tax_lines_invoice_item_id_idx
  ON public.invoice_item_tax_lines (invoice_item_id);

CREATE INDEX invoice_item_tax_lines_tax_schedule_line_id_idx
  ON public.invoice_item_tax_lines (tax_schedule_line_id);

-- ── updated_at triggers ───────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS tax_schedules_updated_at ON public.tax_schedules;
CREATE TRIGGER tax_schedules_updated_at
  BEFORE UPDATE ON public.tax_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS tax_schedule_lines_updated_at ON public.tax_schedule_lines;
CREATE TRIGGER tax_schedule_lines_updated_at
  BEFORE UPDATE ON public.tax_schedule_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS product_tax_categories_updated_at ON public.product_tax_categories;
CREATE TRIGGER product_tax_categories_updated_at
  BEFORE UPDATE ON public.product_tax_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS invoice_item_tax_lines_updated_at ON public.invoice_item_tax_lines;
CREATE TRIGGER invoice_item_tax_lines_updated_at
  BEFORE UPDATE ON public.invoice_item_tax_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE public.tax_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_schedule_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_tax_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_item_tax_lines ENABLE ROW LEVEL SECURITY;

-- Authenticated SELECT: system rows OR tenant rows where user owns / is member
CREATE POLICY tax_schedules_select_authenticated ON public.tax_schedules
  FOR SELECT TO authenticated
  USING (
    business_id IS NULL OR public.finza_user_can_access_business (business_id)
  );

CREATE POLICY tax_schedule_lines_select_authenticated ON public.tax_schedule_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tax_schedules ts
      WHERE ts.id = tax_schedule_lines.tax_schedule_id
        AND (
          ts.business_id IS NULL OR public.finza_user_can_access_business (ts.business_id)
        )
    )
  );

CREATE POLICY product_tax_categories_select_authenticated ON public.product_tax_categories
  FOR SELECT TO authenticated
  USING (
    business_id IS NULL OR public.finza_user_can_access_business (business_id)
  );

-- Mirror invoice_items: scope via invoice → business membership (includes owner via finza_user_can_access_business)
CREATE POLICY invoice_item_tax_lines_select_authenticated ON public.invoice_item_tax_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.invoice_items ii
      INNER JOIN public.invoices inv ON inv.id = ii.invoice_id
      WHERE ii.id = invoice_item_tax_lines.invoice_item_id
        AND public.finza_user_can_access_business (inv.business_id)
    )
  );

CREATE POLICY invoice_item_tax_lines_insert_authenticated ON public.invoice_item_tax_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.invoice_items ii
      INNER JOIN public.invoices inv ON inv.id = ii.invoice_id
      WHERE ii.id = invoice_item_tax_lines.invoice_item_id
        AND public.finza_user_can_access_business (inv.business_id)
    )
  );

CREATE POLICY invoice_item_tax_lines_update_authenticated ON public.invoice_item_tax_lines
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.invoice_items ii
      INNER JOIN public.invoices inv ON inv.id = ii.invoice_id
      WHERE ii.id = invoice_item_tax_lines.invoice_item_id
        AND public.finza_user_can_access_business (inv.business_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.invoice_items ii
      INNER JOIN public.invoices inv ON inv.id = ii.invoice_id
      WHERE ii.id = invoice_item_tax_lines.invoice_item_id
        AND public.finza_user_can_access_business (inv.business_id)
    )
  );

CREATE POLICY invoice_item_tax_lines_delete_authenticated ON public.invoice_item_tax_lines
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.invoice_items ii
      INNER JOIN public.invoices inv ON inv.id = ii.invoice_id
      WHERE ii.id = invoice_item_tax_lines.invoice_item_id
        AND public.finza_user_can_access_business (inv.business_id)
    )
  );

COMMENT ON POLICY invoice_item_tax_lines_select_authenticated ON public.invoice_item_tax_lines IS 'Resolved via invoice_items + invoices; aligns with business membership. Phase 1: no app usage yet.';
COMMENT ON POLICY tax_schedules_select_authenticated ON public.tax_schedules IS 'SELECT for system + tenant rows via finza_user_can_access_business. No INSERT/UPDATE/DELETE policies for authenticated.';

-- ── Seeds (metadata only; rate_percent always NULL) ───────────────────────────
INSERT INTO public.tax_schedules (
  jurisdiction,
  code,
  name,
  effective_from,
  metadata
)
VALUES (
  'GH',
  'GH_EVAT_LEVY_MAP_V8_2',
  'Ghana E-VAT Levy Mapping v8.2',
  '1970-01-01',
  jsonb_build_object(
    'source_document', 'docs/gra-evat-api-v8-2.postman_collection.json.json',
    'notes',
    'Seed metadata only. No numeric rates. effective_from is a technical anchor, not legal validation.',
    'phase', 1,
    'phase_1_no_numeric_rates_seeded', true
  )
);

WITH sched AS (
  SELECT id FROM public.tax_schedules
  WHERE jurisdiction = 'GH' AND code = 'GH_EVAT_LEVY_MAP_V8_2' AND business_id IS NULL AND effective_from = '1970-01-01'
)
INSERT INTO public.tax_schedule_lines (
  tax_schedule_id,
  sort_order,
  internal_code,
  gra_levy_slot,
  gra_field_name,
  display_label,
  classification,
  include_in_total_levy,
  metadata
)
SELECT
  sched.id,
  v.sort_order,
  v.internal_code,
  v.gra_levy_slot::character(1),
  v.gra_field_name,
  v.display_label,
  'levy',
  true,
  v.meta
FROM sched
CROSS JOIN LATERAL (
  VALUES
    (
      1,
      'NHIL'::text,
      'A'::text,
      'levyAmountA'::text,
      'NHIL'::text,
      jsonb_build_object(
        'phase_1_no_numeric_rates_seeded', TRUE,
        'mapping', 'LEVY_A'
      )
    ),
    (
      2,
      'GETFUND'::text,
      'B'::text,
      'levyAmountB'::text,
      'GETFund'::text,
      jsonb_build_object(
        'phase_1_no_numeric_rates_seeded', TRUE,
        'mapping', 'LEVY_B',
        'source_document_note_GETFL_typo_for_GETFund',
        'Postman LEVY_MAPPING spells GETFL; treat as GETFund metadata alignment'
      )
    ),
    (
      3,
      'COVID'::text,
      'C'::text,
      'levyAmountC'::text,
      'COVID'::text,
      jsonb_build_object(
        'phase_1_no_numeric_rates_seeded', TRUE,
        'source_conflict_note_LEVY_MAPPING_OMITS_SLOT_C',
        'LEVY_MAPPING bullet list describes A,B,D,E only; tag table defines levyAmountC as COVID'
      )
    ),
    (
      4,
      'CST'::text,
      'D'::text,
      'levyAmountD'::text,
      'CST'::text,
      jsonb_build_object('phase_1_no_numeric_rates_seeded', TRUE, 'mapping', 'LEVY_D')
    ),
    (
      5,
      'TOURISM'::text,
      'E'::text,
      'levyAmountE'::text,
      'Tourism'::text,
      jsonb_build_object('phase_1_no_numeric_rates_seeded', TRUE, 'mapping', 'LEVY_E')
    )
) AS v (
  sort_order,
  internal_code,
  gra_levy_slot,
  gra_field_name,
  display_label,
  meta
);

INSERT INTO public.product_tax_categories (
  jurisdiction,
  code,
  gra_item_category,
  label,
  description,
  metadata
)
VALUES
  (
    'GH',
    'STANDARD',
    NULL,
    'Standard',
    'Default / standard taxable supply',
    '{"gra_item_category":"omit_or_empty_in_postman_for_standard_items"}'::jsonb
  ),
  (
    'GH',
    'CST',
    'CST',
    'CST',
    'itemCategory CST (GRA Postman)',
    NULL
  ),
  (
    'GH',
    'TRSM',
    'TRSM',
    'Tourism / TRSM',
    'itemCategory TRSM (GRA Postman)',
    NULL
  ),
  (
    'GH',
    'EXM',
    'EXM',
    'Zero rated',
    'itemCategory EXM (GRA Postman)',
    NULL
  ),
  (
    'GH',
    'RNT',
    'RNT',
    'Rent',
    'itemCategory RNT (GRA Postman)',
    NULL
  ),
  (
    'GH',
    'EXC_PLASTIC',
    'EXC_PLASTIC',
    'Plastic excise',
    'itemCategory EXC_PLASTIC (GRA Postman)',
    NULL
  );
