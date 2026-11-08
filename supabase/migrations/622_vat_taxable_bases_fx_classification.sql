-- ============================================================================
-- Migration 622: FX-aware VAT taxable bases and document classification
-- ============================================================================
-- Scope:
--   * Add explicit document-level VAT classification evidence to invoices,
--     bills, credit notes and expenses (F-04).
--   * Convert foreign-currency document bases to the business home currency
--     using the same recorded fx_rate convention as the ledger (F-02).
--   * Populate zero-rated and exempt purchase totals; count unclassified,
--     fallback, invalid-FX and classification-conflict documents (F-04, F-18).
--
-- Existing rows are classified from evidence only: standard when tax exists,
-- zero/exempt only when an explicit code exists, otherwise 'unclassified'.
-- No unknown transaction is assigned to zero-rated or exempt.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Classification columns and constraints
-- ----------------------------------------------------------------------------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS vat_classification TEXT;
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS vat_classification TEXT;
ALTER TABLE public.credit_notes
  ADD COLUMN IF NOT EXISTS vat_classification TEXT;
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS vat_classification TEXT;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_vat_classification_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_vat_classification_check
  CHECK (
    vat_classification IS NULL OR vat_classification IN
      ('standard', 'zero', 'exempt', 'out_of_scope', 'mixed', 'unclassified')
  ) NOT VALID;

ALTER TABLE public.bills
  DROP CONSTRAINT IF EXISTS bills_vat_classification_check;
ALTER TABLE public.bills
  ADD CONSTRAINT bills_vat_classification_check
  CHECK (
    vat_classification IS NULL OR vat_classification IN
      ('standard', 'zero', 'exempt', 'out_of_scope', 'mixed', 'unclassified')
  ) NOT VALID;

ALTER TABLE public.credit_notes
  DROP CONSTRAINT IF EXISTS credit_notes_vat_classification_check;
ALTER TABLE public.credit_notes
  ADD CONSTRAINT credit_notes_vat_classification_check
  CHECK (
    vat_classification IS NULL OR vat_classification IN
      ('standard', 'zero', 'exempt', 'out_of_scope', 'mixed', 'unclassified')
  ) NOT VALID;

ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_vat_classification_check;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_vat_classification_check
  CHECK (
    vat_classification IS NULL OR vat_classification IN
      ('standard', 'zero', 'exempt', 'out_of_scope', 'mixed', 'unclassified')
  ) NOT VALID;

COMMENT ON COLUMN public.invoices.vat_classification IS
  'Document-level VAT treatment: standard, zero, exempt, out_of_scope, mixed or unclassified. Unknown legacy rows stay unclassified.';
COMMENT ON COLUMN public.bills.vat_classification IS
  'Document-level purchase VAT treatment. Unknown legacy rows stay unclassified.';
COMMENT ON COLUMN public.credit_notes.vat_classification IS
  'Document-level credit-note VAT treatment. Inherits zero/exempt from the linked invoice when evidence exists.';
COMMENT ON COLUMN public.expenses.vat_classification IS
  'Document-level expense VAT treatment. Unknown legacy rows stay unclassified.';

-- ----------------------------------------------------------------------------
-- 2) Tax-line helpers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tax_line_amount(
  p_tax_lines JSONB,
  p_code TEXT
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN upper(COALESCE(line->>'code', '')) = upper(COALESCE(p_code, ''))
        THEN COALESCE(NULLIF(line->>'amount', '')::NUMERIC, 0)
      ELSE 0
    END
  ), 0)
  FROM jsonb_array_elements(
    CASE
      WHEN p_tax_lines IS NULL THEN '[]'::JSONB
      WHEN jsonb_typeof(p_tax_lines) = 'array' THEN p_tax_lines
      WHEN jsonb_typeof(p_tax_lines) = 'object' AND p_tax_lines ? 'lines'
        THEN p_tax_lines->'lines'
      WHEN jsonb_typeof(p_tax_lines) = 'object' AND p_tax_lines ? 'tax_lines'
        THEN p_tax_lines->'tax_lines'
      ELSE '[]'::JSONB
    END
  ) AS line;
$$;

CREATE OR REPLACE FUNCTION public.tax_lines_home_tax(
  p_tax_lines JSONB,
  p_fx_rate NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN COALESCE(p_fx_rate, 0) > 0
        THEN ROUND(COALESCE(NULLIF(line->>'amount', '')::NUMERIC, 0) * p_fx_rate, 2)
      ELSE COALESCE(NULLIF(line->>'amount', '')::NUMERIC, 0)
    END
  ), 0)
  FROM jsonb_array_elements(
    CASE
      WHEN p_tax_lines IS NULL THEN '[]'::JSONB
      WHEN jsonb_typeof(p_tax_lines) = 'array' THEN p_tax_lines
      WHEN jsonb_typeof(p_tax_lines) = 'object' AND p_tax_lines ? 'lines'
        THEN p_tax_lines->'lines'
      WHEN jsonb_typeof(p_tax_lines) = 'object' AND p_tax_lines ? 'tax_lines'
        THEN p_tax_lines->'tax_lines'
      ELSE '[]'::JSONB
    END
  ) AS line
  WHERE upper(COALESCE(line->>'code', '')) IN ('VAT', 'NHIL', 'GETFUND', 'COVID');
$$;

-- ----------------------------------------------------------------------------
-- 3) Evidence-based classification backfill (unknown stays unclassified)
-- ----------------------------------------------------------------------------
UPDATE public.invoices i
SET vat_classification = CASE
  WHEN public.tax_line_amount(i.tax_lines, 'VAT') > 0
    OR COALESCE(i.total_tax, 0) > 0 THEN 'standard'
  WHEN public.tax_line_amount(i.tax_lines, 'ZERO') > 0 THEN 'zero'
  WHEN public.tax_line_amount(i.tax_lines, 'EXEMPT') > 0 THEN 'exempt'
  ELSE 'unclassified'
END
WHERE i.vat_classification IS NULL;

UPDATE public.bills b
SET vat_classification = CASE
  WHEN public.tax_line_amount(b.tax_lines, 'VAT') > 0
    OR COALESCE(b.vat, 0) > 0
    OR COALESCE(b.total_tax, 0) > 0 THEN 'standard'
  WHEN public.tax_line_amount(b.tax_lines, 'ZERO') > 0 THEN 'zero'
  WHEN public.tax_line_amount(b.tax_lines, 'EXEMPT') > 0 THEN 'exempt'
  ELSE 'unclassified'
END
WHERE b.vat_classification IS NULL;

UPDATE public.credit_notes cn
SET vat_classification = CASE
  WHEN public.tax_line_amount(cn.tax_lines, 'VAT') > 0
    OR COALESCE(cn.total_tax, 0) > 0 THEN 'standard'
  WHEN i.vat_classification IN ('zero', 'exempt') THEN i.vat_classification
  ELSE 'unclassified'
END
FROM public.invoices i
WHERE i.id = cn.invoice_id
  AND cn.vat_classification IS NULL;

UPDATE public.expenses e
SET vat_classification = CASE
  WHEN COALESCE(e.vat, 0) > 0
    OR COALESCE(e.nhil, 0) > 0
    OR COALESCE(e.getfund, 0) > 0
    OR COALESCE(e.covid, 0) > 0 THEN 'standard'
  ELSE 'unclassified'
END
WHERE e.vat_classification IS NULL;

-- ----------------------------------------------------------------------------
-- 4) FX-aware, classification-aware extraction
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.extract_vat_taxable_bases(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_home_currency TEXT;
  v_standard_sales NUMERIC := 0;
  v_retail_standard NUMERIC := 0;
  v_retail_zero NUMERIC := 0;
  v_retail_exempt NUMERIC := 0;
  v_retail_fallback INTEGER := 0;
  v_zero_sales NUMERIC := 0;
  v_exempt_sales NUMERIC := 0;
  v_standard_purchases NUMERIC := 0;
  v_zero_purchases NUMERIC := 0;
  v_exempt_purchases NUMERIC := 0;
  v_bill_standard NUMERIC := 0;
  v_bill_zero NUMERIC := 0;
  v_bill_exempt NUMERIC := 0;
  v_expense_standard NUMERIC := 0;
  v_expense_zero NUMERIC := 0;
  v_expense_exempt NUMERIC := 0;
  v_credit_note_standard NUMERIC := 0;
  v_credit_note_zero NUMERIC := 0;
  v_credit_note_exempt NUMERIC := 0;
  v_ledger_revenue NUMERIC := 0;
  v_unclassified_sales INTEGER := 0;
  v_unclassified_purchases INTEGER := 0;
  v_fallback_sales INTEGER := 0;
  v_fallback_purchases INTEGER := 0;
  v_bill_fallback INTEGER := 0;
  v_cn_fallback INTEGER := 0;
  v_cn_invalid_fx INTEGER := 0;
  v_invalid_fx INTEGER := 0;
  v_bill_invalid_fx INTEGER := 0;
  v_expense_invalid_fx INTEGER := 0;
  v_classification_conflicts INTEGER := 0;
  v_bill_conflicts INTEGER := 0;
  v_invoice_class_conflicts INTEGER := 0;
  v_bill_class_conflicts INTEGER := 0;
  v_retail_conflicts INTEGER := 0;
  v_expense_unclassified INTEGER := 0;
  v_unsupported_fx_credit_notes INTEGER := 0;
  v_unclassified_credit_notes INTEGER := 0;
  v_cn_class_conflicts INTEGER := 0;
  v_warnings JSONB := '[]'::JSONB;
BEGIN
  IF p_business_id IS NULL OR p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'business_id, start_date and end_date are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(default_currency, 'GHS')
  INTO v_home_currency
  FROM public.businesses
  WHERE id = p_business_id;

  v_home_currency := COALESCE(v_home_currency, 'GHS');

  -- Standard-rated invoice sales.
  SELECT
    COALESCE(SUM(
      CASE
        WHEN i.fx_rate IS NOT NULL AND i.fx_rate > 0 AND i.currency_code IS NOT NULL
          THEN ROUND(
            COALESCE(
              i.home_currency_total,
              ROUND(COALESCE(i.total, i.subtotal, 0) * i.fx_rate, 2)
            )
            - public.tax_lines_home_tax(i.tax_lines, i.fx_rate),
            2
          )
        ELSE COALESCE(public.extract_tax_line_base(i.tax_lines), i.subtotal, 0)
      END
    ), 0),
    COUNT(*) FILTER (
      WHERE public.extract_tax_line_base(i.tax_lines) IS NULL
    ),
    COUNT(*) FILTER (
      WHERE COALESCE(i.total_tax, 0) = 0
        AND public.tax_line_amount(i.tax_lines, 'VAT') = 0
    ),
    COUNT(*) FILTER (
      WHERE i.currency_code IS NOT NULL
        AND i.currency_code <> v_home_currency
        AND COALESCE(i.fx_rate, 0) <= 0
    )
  INTO v_standard_sales, v_fallback_sales, v_classification_conflicts, v_invalid_fx
  FROM public.invoices i
  WHERE i.business_id = p_business_id
    AND i.deleted_at IS NULL
    AND i.issue_date BETWEEN p_start_date AND p_end_date
    AND COALESCE(i.status, '') NOT IN ('draft', 'void', 'cancelled')
    AND i.vat_classification = 'standard';

  SELECT COUNT(*) INTO v_invoice_class_conflicts
  FROM public.invoices i
  WHERE i.business_id = p_business_id
    AND i.deleted_at IS NULL
    AND i.issue_date BETWEEN p_start_date AND p_end_date
    AND COALESCE(i.status, '') NOT IN ('draft', 'void', 'cancelled')
    AND i.vat_classification IN ('zero', 'exempt', 'out_of_scope')
    AND (
      public.tax_line_amount(i.tax_lines, 'VAT') > 0
      OR COALESCE(i.total_tax, 0) > 0
    );

  v_classification_conflicts := v_classification_conflicts + v_invoice_class_conflicts;

  -- Zero-rated and exempt invoice sales.
  SELECT
    COALESCE(SUM(
      CASE
        WHEN i.fx_rate IS NOT NULL AND i.fx_rate > 0 AND i.currency_code IS NOT NULL
          THEN COALESCE(i.home_currency_total, ROUND(COALESCE(i.subtotal, 0) * i.fx_rate, 2))
        ELSE COALESCE(i.subtotal, 0)
      END
    ), 0)
  INTO v_zero_sales
  FROM public.invoices i
  WHERE i.business_id = p_business_id
    AND i.deleted_at IS NULL
    AND i.issue_date BETWEEN p_start_date AND p_end_date
    AND COALESCE(i.status, '') NOT IN ('draft', 'void', 'cancelled')
    AND i.vat_classification = 'zero';

  SELECT
    COALESCE(SUM(
      CASE
        WHEN i.fx_rate IS NOT NULL AND i.fx_rate > 0 AND i.currency_code IS NOT NULL
          THEN COALESCE(i.home_currency_total, ROUND(COALESCE(i.subtotal, 0) * i.fx_rate, 2))
        ELSE COALESCE(i.subtotal, 0)
      END
    ), 0)
  INTO v_exempt_sales
  FROM public.invoices i
  WHERE i.business_id = p_business_id
    AND i.deleted_at IS NULL
    AND i.issue_date BETWEEN p_start_date AND p_end_date
    AND COALESCE(i.status, '') NOT IN ('draft', 'void', 'cancelled')
    AND i.vat_classification = 'exempt';

  -- Unclassified or mixed invoice sales.
  SELECT COUNT(*) INTO v_unclassified_sales
  FROM public.invoices i
  WHERE i.business_id = p_business_id
    AND i.deleted_at IS NULL
    AND i.issue_date BETWEEN p_start_date AND p_end_date
    AND COALESCE(i.status, '') NOT IN ('draft', 'void', 'cancelled')
    AND COALESCE(i.vat_classification, 'unclassified') IN ('unclassified', 'mixed')
    AND COALESCE(i.subtotal, 0) > 0;

  -- Retail sales. Amounts are already in the business home currency. The
  -- sale's net total is the authoritative post-discount base; zero-rated and
  -- exempt item gross is allocated after line and cart discounts, then
  -- subtracted so mixed carts are not double counted (F-18).
  SELECT
    COALESCE(SUM(
      CASE
        WHEN NULLIF(s.tax_lines->>'subtotal_excl_tax', '') IS NOT NULL THEN
          GREATEST(
            (s.tax_lines->>'subtotal_excl_tax')::NUMERIC
              - COALESCE(items.zero_gross, 0)
              - COALESCE(items.exempt_gross, 0),
            0
          )
        WHEN public.extract_tax_line_base(s.tax_lines) IS NOT NULL THEN
          public.extract_tax_line_base(s.tax_lines)
        WHEN s.tax_lines IS NOT NULL AND s.tax_lines <> '{}'::JSONB THEN
          GREATEST(
            COALESCE(s.subtotal_after_discount, 0)
              - COALESCE(items.zero_gross, 0)
              - COALESCE(items.exempt_gross, 0),
            0
          )
        ELSE 0
      END
    ), 0),
    COALESCE(SUM(COALESCE(items.zero_gross, 0)), 0),
    COALESCE(SUM(COALESCE(items.exempt_gross, 0)), 0),
    COUNT(*) FILTER (
      WHERE s.tax_lines IS NOT NULL
        AND s.tax_lines <> '{}'::JSONB
        AND NULLIF(s.tax_lines->>'subtotal_excl_tax', '') IS NULL
        AND public.extract_tax_line_base(s.tax_lines) IS NULL
    )
  INTO v_retail_standard, v_retail_zero, v_retail_exempt, v_retail_fallback
  FROM public.sales s
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(
        CASE WHEN COALESCE(c.vat_type, 'standard') = 'zero' THEN
          (si.price * si.qty - COALESCE(si.discount_amount, 0)) * ratio.ratio
        ELSE 0 END
      ), 0) AS zero_gross,
      COALESCE(SUM(
        CASE WHEN COALESCE(c.vat_type, 'standard') = 'exempt' THEN
          (si.price * si.qty - COALESCE(si.discount_amount, 0)) * ratio.ratio
        ELSE 0 END
      ), 0) AS exempt_gross
    FROM public.sale_items si
    LEFT JOIN public.products p ON p.id = si.product_id
    LEFT JOIN public.categories c ON c.id = p.category_id
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN COALESCE(
          SUM(si2.price * si2.qty - COALESCE(si2.discount_amount, 0)),
          0
        ) <= 0 THEN 1
        WHEN s.subtotal_after_discount IS NULL THEN
          CASE
            WHEN COALESCE(s.subtotal_before_discount, 0) > 0 THEN
              s.subtotal_before_discount
                / SUM(si2.price * si2.qty - COALESCE(si2.discount_amount, 0))
            ELSE 1
          END
        ELSE
          s.subtotal_after_discount
            / SUM(si2.price * si2.qty - COALESCE(si2.discount_amount, 0))
      END AS ratio
      FROM public.sale_items si2
      WHERE si2.sale_id = s.id
    ) ratio
    WHERE si.sale_id = s.id
  ) items ON TRUE
  WHERE s.business_id = p_business_id
    AND s.created_at::date BETWEEN p_start_date AND p_end_date
    AND COALESCE(s.payment_status, '') NOT IN
      ('void', 'voided', 'cancelled', 'refunded', 'failed', 'pending');

  v_standard_sales := v_standard_sales + v_retail_standard;
  v_zero_sales := v_zero_sales + v_retail_zero;
  v_exempt_sales := v_exempt_sales + v_retail_exempt;
  v_fallback_sales := v_fallback_sales + v_retail_fallback;

  SELECT COUNT(*) INTO v_retail_conflicts
  FROM public.sales s
  JOIN public.sale_items si ON si.sale_id = s.id
  LEFT JOIN public.products p ON p.id = si.product_id
  LEFT JOIN public.categories c ON c.id = p.category_id
  WHERE s.business_id = p_business_id
    AND s.created_at::date BETWEEN p_start_date AND p_end_date
    AND COALESCE(s.payment_status, '') NOT IN
      ('void', 'voided', 'cancelled', 'refunded', 'failed', 'pending')
    AND c.vat_type IN ('zero', 'exempt')
    AND s.tax_lines IS NOT NULL
    AND s.tax_lines <> '{}'::JSONB
    AND public.tax_line_amount(s.tax_lines, 'VAT') > 0;

  v_classification_conflicts := v_classification_conflicts + v_retail_conflicts;

  -- Standard-rated bill purchases.
  SELECT
    COALESCE(SUM(
      CASE
        WHEN b.fx_rate IS NOT NULL AND b.fx_rate > 0 AND b.currency_code IS NOT NULL
          THEN ROUND(COALESCE(public.extract_tax_line_base(b.tax_lines), b.subtotal, 0) * b.fx_rate, 2)
        ELSE COALESCE(public.extract_tax_line_base(b.tax_lines), b.subtotal, 0)
      END
    ), 0),
    COUNT(*) FILTER (WHERE public.extract_tax_line_base(b.tax_lines) IS NULL),
    COUNT(*) FILTER (
      WHERE COALESCE(b.total_tax, 0) = 0
        AND public.tax_line_amount(b.tax_lines, 'VAT') = 0
    ),
    COUNT(*) FILTER (
      WHERE b.currency_code IS NOT NULL
        AND b.currency_code <> v_home_currency
        AND COALESCE(b.fx_rate, 0) <= 0
    )
  INTO v_bill_standard, v_bill_fallback, v_bill_conflicts, v_bill_invalid_fx
  FROM public.bills b
  WHERE b.business_id = p_business_id
    AND b.deleted_at IS NULL
    AND b.issue_date BETWEEN p_start_date AND p_end_date
    AND COALESCE(b.status, '') <> 'draft'
    AND b.vat_classification = 'standard';

  v_standard_purchases := v_standard_purchases + v_bill_standard;
  v_fallback_purchases := v_fallback_purchases + v_bill_fallback;
  v_classification_conflicts := v_classification_conflicts + v_bill_conflicts;
  v_invalid_fx := v_invalid_fx + v_bill_invalid_fx;

  SELECT COUNT(*) INTO v_bill_class_conflicts
  FROM public.bills b
  WHERE b.business_id = p_business_id
    AND b.deleted_at IS NULL
    AND b.issue_date BETWEEN p_start_date AND p_end_date
    AND COALESCE(b.status, '') <> 'draft'
    AND b.vat_classification IN ('zero', 'exempt', 'out_of_scope')
    AND (
      public.tax_line_amount(b.tax_lines, 'VAT') > 0
      OR COALESCE(b.vat, 0) > 0
      OR COALESCE(b.total_tax, 0) > 0
    );

  v_classification_conflicts := v_classification_conflicts + v_bill_class_conflicts;

  -- Zero-rated and exempt bill purchases.
  SELECT COALESCE(SUM(
    CASE
      WHEN b.fx_rate IS NOT NULL AND b.fx_rate > 0 AND b.currency_code IS NOT NULL
        THEN COALESCE(b.home_currency_total, ROUND(COALESCE(b.subtotal, 0) * b.fx_rate, 2))
      ELSE COALESCE(b.subtotal, 0)
    END
  ), 0)
  INTO v_bill_zero
  FROM public.bills b
  WHERE b.business_id = p_business_id
    AND b.deleted_at IS NULL
    AND b.issue_date BETWEEN p_start_date AND p_end_date
    AND COALESCE(b.status, '') <> 'draft'
    AND b.vat_classification = 'zero';

  v_zero_purchases := v_zero_purchases + v_bill_zero;

  SELECT COALESCE(SUM(
    CASE
      WHEN b.fx_rate IS NOT NULL AND b.fx_rate > 0 AND b.currency_code IS NOT NULL
        THEN COALESCE(b.home_currency_total, ROUND(COALESCE(b.subtotal, 0) * b.fx_rate, 2))
      ELSE COALESCE(b.subtotal, 0)
    END
  ), 0)
  INTO v_bill_exempt
  FROM public.bills b
  WHERE b.business_id = p_business_id
    AND b.deleted_at IS NULL
    AND b.issue_date BETWEEN p_start_date AND p_end_date
    AND COALESCE(b.status, '') <> 'draft'
    AND b.vat_classification = 'exempt';

  v_exempt_purchases := v_exempt_purchases + v_bill_exempt;

  -- Unclassified or mixed bill purchases.
  SELECT COUNT(*) INTO v_unclassified_purchases
  FROM public.bills b
  WHERE b.business_id = p_business_id
    AND b.deleted_at IS NULL
    AND b.issue_date BETWEEN p_start_date AND p_end_date
    AND COALESCE(b.status, '') <> 'draft'
    AND COALESCE(b.vat_classification, 'unclassified') IN ('unclassified', 'mixed')
    AND COALESCE(b.subtotal, 0) > 0;

  -- Expenses: standard-rated input purchases.
  SELECT
    COALESCE(SUM(
      CASE
        WHEN e.fx_rate IS NOT NULL AND e.fx_rate > 0 AND e.currency_code IS NOT NULL
          THEN ROUND(COALESCE(e.amount, 0) * e.fx_rate, 2)
        ELSE COALESCE(e.amount, 0)
      END
    ), 0),
    COUNT(*) FILTER (
      WHERE e.currency_code IS NOT NULL
        AND e.currency_code <> v_home_currency
        AND COALESCE(e.fx_rate, 0) <= 0
    )
  INTO v_expense_standard, v_expense_invalid_fx
  FROM public.expenses e
  WHERE e.business_id = p_business_id
    AND e.deleted_at IS NULL
    AND e.date BETWEEN p_start_date AND p_end_date
    AND e.vat_classification = 'standard';

  v_standard_purchases := v_standard_purchases + v_expense_standard;
  v_invalid_fx := v_invalid_fx + v_expense_invalid_fx;

  -- Expenses: zero-rated and exempt purchases.
  SELECT COALESCE(SUM(
    CASE
      WHEN e.fx_rate IS NOT NULL AND e.fx_rate > 0 AND e.currency_code IS NOT NULL
        THEN ROUND(COALESCE(e.amount, 0) * e.fx_rate, 2)
      ELSE COALESCE(e.amount, 0)
    END
  ), 0)
  INTO v_expense_zero
  FROM public.expenses e
  WHERE e.business_id = p_business_id
    AND e.deleted_at IS NULL
    AND e.date BETWEEN p_start_date AND p_end_date
    AND e.vat_classification = 'zero';

  v_zero_purchases := v_zero_purchases + v_expense_zero;

  SELECT COALESCE(SUM(
    CASE
      WHEN e.fx_rate IS NOT NULL AND e.fx_rate > 0 AND e.currency_code IS NOT NULL
        THEN ROUND(COALESCE(e.amount, 0) * e.fx_rate, 2)
      ELSE COALESCE(e.amount, 0)
    END
  ), 0)
  INTO v_expense_exempt
  FROM public.expenses e
  WHERE e.business_id = p_business_id
    AND e.deleted_at IS NULL
    AND e.date BETWEEN p_start_date AND p_end_date
    AND e.vat_classification = 'exempt';

  v_exempt_purchases := v_exempt_purchases + v_expense_exempt;

  -- Unclassified expenses.
  SELECT COUNT(*) INTO v_expense_unclassified
  FROM public.expenses e
  WHERE e.business_id = p_business_id
    AND e.deleted_at IS NULL
    AND e.date BETWEEN p_start_date AND p_end_date
    AND COALESCE(e.vat_classification, 'unclassified') IN ('unclassified', 'mixed')
    AND COALESCE(e.amount, 0) > 0;

  v_unclassified_purchases := v_unclassified_purchases + v_expense_unclassified;

  -- Applied credit notes. Standard credit notes reduce standard sales; zero
  -- and exempt credit notes reduce their respective classifications.
  SELECT
    COALESCE(SUM(
      CASE
        WHEN i.currency_code IS NOT NULL
          AND i.currency_code <> v_home_currency
          AND COALESCE(i.fx_rate, 0) <= 0 THEN NULL
        WHEN i.currency_code IS NOT NULL AND COALESCE(i.fx_rate, 0) > 0
          THEN ROUND(COALESCE(public.extract_tax_line_base(cn.tax_lines), cn.subtotal, 0) * i.fx_rate, 2)
        ELSE COALESCE(public.extract_tax_line_base(cn.tax_lines), cn.subtotal, 0)
      END
    ), 0),
    COUNT(*) FILTER (
      WHERE public.extract_tax_line_base(cn.tax_lines) IS NULL
    ),
    COUNT(*) FILTER (
      WHERE i.currency_code IS NOT NULL
        AND i.currency_code <> v_home_currency
        AND COALESCE(i.fx_rate, 0) <= 0
    )
  INTO v_credit_note_standard, v_cn_fallback, v_cn_invalid_fx
  FROM public.credit_notes cn
  JOIN public.invoices i ON i.id = cn.invoice_id
  WHERE cn.business_id = p_business_id
    AND cn.deleted_at IS NULL
    AND cn.date BETWEEN p_start_date AND p_end_date
    AND cn.status = 'applied'
    AND cn.vat_classification = 'standard';

  v_standard_sales := GREATEST(v_standard_sales - v_credit_note_standard, 0);
  v_fallback_sales := v_fallback_sales + v_cn_fallback;
  v_invalid_fx := v_invalid_fx + v_cn_invalid_fx;

  -- Foreign-currency credit notes are converted with the linked invoice's
  -- recorded fx_rate. This counter is retained for blocked legacy evidence
  -- where the linked invoice is foreign but has no valid rate.
  SELECT COUNT(*) INTO v_unsupported_fx_credit_notes
  FROM public.credit_notes cn
  JOIN public.invoices i ON i.id = cn.invoice_id
  WHERE cn.business_id = p_business_id
    AND cn.deleted_at IS NULL
    AND cn.date BETWEEN p_start_date AND p_end_date
    AND cn.status = 'applied'
    AND cn.vat_classification IN ('standard', 'zero', 'exempt')
    AND i.currency_code IS NOT NULL
    AND i.currency_code <> v_home_currency
    AND COALESCE(i.fx_rate, 0) <= 0;

  SELECT COUNT(*) INTO v_unclassified_credit_notes
  FROM public.credit_notes cn
  WHERE cn.business_id = p_business_id
    AND cn.deleted_at IS NULL
    AND cn.date BETWEEN p_start_date AND p_end_date
    AND cn.status = 'applied'
    AND COALESCE(cn.vat_classification, 'unclassified') IN ('unclassified', 'mixed')
    AND COALESCE(cn.subtotal, 0) > 0;

  v_unclassified_sales := v_unclassified_sales + v_unclassified_credit_notes;

  SELECT COALESCE(SUM(
    CASE
      WHEN i.currency_code IS NOT NULL
        AND i.currency_code <> v_home_currency
        AND COALESCE(i.fx_rate, 0) <= 0 THEN NULL
      WHEN i.currency_code IS NOT NULL AND COALESCE(i.fx_rate, 0) > 0
        THEN ROUND(COALESCE(cn.subtotal, 0) * i.fx_rate, 2)
      ELSE COALESCE(cn.subtotal, 0)
    END
  ), 0)
  INTO v_credit_note_zero
  FROM public.credit_notes cn
  JOIN public.invoices i ON i.id = cn.invoice_id
  WHERE cn.business_id = p_business_id
    AND cn.deleted_at IS NULL
    AND cn.date BETWEEN p_start_date AND p_end_date
    AND cn.status = 'applied'
    AND cn.vat_classification = 'zero';

  SELECT COALESCE(SUM(
    CASE
      WHEN i.currency_code IS NOT NULL
        AND i.currency_code <> v_home_currency
        AND COALESCE(i.fx_rate, 0) <= 0 THEN NULL
      WHEN i.currency_code IS NOT NULL AND COALESCE(i.fx_rate, 0) > 0
        THEN ROUND(COALESCE(cn.subtotal, 0) * i.fx_rate, 2)
      ELSE COALESCE(cn.subtotal, 0)
    END
  ), 0)
  INTO v_credit_note_exempt
  FROM public.credit_notes cn
  JOIN public.invoices i ON i.id = cn.invoice_id
  WHERE cn.business_id = p_business_id
    AND cn.deleted_at IS NULL
    AND cn.date BETWEEN p_start_date AND p_end_date
    AND cn.status = 'applied'
    AND cn.vat_classification = 'exempt';

  v_zero_sales := GREATEST(v_zero_sales - v_credit_note_zero, 0);
  v_exempt_sales := GREATEST(v_exempt_sales - v_credit_note_exempt, 0);

  SELECT COUNT(*) INTO v_cn_class_conflicts
  FROM public.credit_notes cn
  WHERE cn.business_id = p_business_id
    AND cn.deleted_at IS NULL
    AND cn.date BETWEEN p_start_date AND p_end_date
    AND cn.status = 'applied'
    AND cn.vat_classification IN ('zero', 'exempt', 'out_of_scope')
    AND (
      public.tax_line_amount(cn.tax_lines, 'VAT') > 0
      OR COALESCE(cn.total_tax, 0) > 0
    );

  v_classification_conflicts := v_classification_conflicts + v_cn_class_conflicts;

  -- Ledger revenue movement for reconciliation (credits - debits).
  SELECT COALESCE(SUM(jel.credit - jel.debit), 0)
  INTO v_ledger_revenue
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.accounts a ON a.id = jel.account_id
  WHERE je.business_id = p_business_id
    AND je.date BETWEEN p_start_date AND p_end_date
    AND a.type IN ('revenue', 'income')
    AND a.deleted_at IS NULL
    AND COALESCE(je.reference_type, '') <> 'vat_return_payment';

  IF v_unclassified_sales > 0 THEN
    v_warnings := v_warnings || jsonb_build_array(
      format(
        '%s sales document(s) in this period have no VAT classification. Classify them before filing; zero-rated and exempt supplies are not inferred.',
        v_unclassified_sales
      )
    );
  END IF;

  IF v_unclassified_purchases > 0 THEN
    v_warnings := v_warnings || jsonb_build_array(
      format(
        '%s purchase document(s) in this period have no VAT classification. Classify them before filing; zero-rated and exempt purchases are not inferred.',
        v_unclassified_purchases
      )
    );
  END IF;

  IF v_fallback_sales > 0 THEN
    v_warnings := v_warnings || jsonb_build_array(
      format(
        '%s sales document(s) are marked standard but have no persisted tax-line base. Their subtotal was used; review the tax breakdown.',
        v_fallback_sales
      )
    );
  END IF;

  IF v_fallback_purchases > 0 THEN
    v_warnings := v_warnings || jsonb_build_array(
      format(
        '%s purchase document(s) are marked standard but have no persisted tax-line base. Their subtotal was used; review the tax breakdown.',
        v_fallback_purchases
      )
    );
  END IF;

  IF v_invalid_fx > 0 THEN
    v_warnings := v_warnings || jsonb_build_array(
      format(
        '%s foreign-currency document(s) have a missing or invalid exchange rate. Their GHS taxable base cannot be determined.',
        v_invalid_fx
      )
    );
  END IF;

  IF v_classification_conflicts > 0 THEN
    v_warnings := v_warnings || jsonb_build_array(
      format(
        '%s document(s) have a VAT classification that conflicts with their tax evidence. Review the classification before filing.',
        v_classification_conflicts
      )
    );
  END IF;

  IF v_unsupported_fx_credit_notes > 0 THEN
    v_warnings := v_warnings || jsonb_build_array(
      format(
        '%s foreign-currency credit note(s) cannot be converted because the linked invoice FX evidence is incomplete. Review before filing.',
        v_unsupported_fx_credit_notes
      )
    );
  END IF;

  IF ABS((v_standard_sales + v_zero_sales + v_exempt_sales) - v_ledger_revenue) > 0.05 THEN
    v_warnings := v_warnings || jsonb_build_array(
      format(
        'Taxable sales (GHS %s) do not reconcile to ledger revenue credits (GHS %s). Review revenue postings and document classification.',
        ROUND(v_standard_sales + v_zero_sales + v_exempt_sales, 2),
        ROUND(v_ledger_revenue, 2)
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'standard_rated_sales', ROUND(v_standard_sales, 2),
    'zero_rated_sales', ROUND(v_zero_sales, 2),
    'exempt_sales', ROUND(v_exempt_sales, 2),
    'standard_rated_purchases', ROUND(v_standard_purchases, 2),
    'zero_rated_purchases', ROUND(v_zero_purchases, 2),
    'exempt_purchases', ROUND(v_exempt_purchases, 2),
    'ledger_revenue_credits', ROUND(v_ledger_revenue, 2),
    'unclassified_sales_count', v_unclassified_sales,
    'unclassified_purchases_count', v_unclassified_purchases,
    'fallback_sales_count', v_fallback_sales,
    'fallback_purchases_count', v_fallback_purchases,
    'invalid_fx_count', v_invalid_fx,
    'classification_conflict_count', v_classification_conflicts,
    'unsupported_fx_credit_note_count', v_unsupported_fx_credit_notes,
    'warnings', v_warnings
  );
END;
$$;

COMMENT ON FUNCTION public.extract_vat_taxable_bases(UUID, DATE, DATE) IS
  'Read-only, FX-aware VAT taxable-base extraction from persisted tax-line bases and document classification. Returns explicit counts for unclassified, fallback, invalid-FX, conflicting and unsupported FX credit-note evidence.';

REVOKE ALL ON FUNCTION public.tax_line_amount(JSONB, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tax_line_amount(JSONB, TEXT)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.tax_lines_home_tax(JSONB, NUMERIC)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tax_lines_home_tax(JSONB, NUMERIC)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.extract_vat_taxable_bases(UUID, DATE, DATE)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extract_vat_taxable_bases(UUID, DATE, DATE)
  TO authenticated, service_role;
