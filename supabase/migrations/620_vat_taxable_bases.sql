-- ============================================================================
-- Migration 620: VAT return taxable bases from transaction evidence
-- ============================================================================
-- Scope:
--   * Add explicit zero-rated and exempt sales/purchase columns to vat_returns.
--   * Add a read-only extraction function that derives standard-rated taxable
--     bases from persisted tax-line bases (invoices, bills, retail sales) and
--     classifies retail zero-rated/exempt supplies from product categories.
--   * Never infer taxable bases from output/input VAT / 15%.
--
-- Existing returns are not rewritten. New returns persist the extracted bases.
-- Where documents are unclassified, the function returns explicit warnings so
-- the API can surface a data-quality exception instead of inventing figures.
-- ============================================================================

ALTER TABLE public.vat_returns
  ADD COLUMN IF NOT EXISTS total_zero_rated_sales NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_exempt_sales NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_zero_rated_purchases NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_exempt_purchases NUMERIC DEFAULT 0;

COMMENT ON COLUMN public.vat_returns.total_zero_rated_sales IS
  'Zero-rated sales for the period, derived from classified retail supplies. Existing returns remain 0 until reviewed.';
COMMENT ON COLUMN public.vat_returns.total_exempt_sales IS
  'Exempt sales for the period, derived from classified retail supplies. Existing returns remain 0 until reviewed.';
COMMENT ON COLUMN public.vat_returns.total_zero_rated_purchases IS
  'Zero-rated purchases for the period. Existing returns remain 0 until reviewed.';
COMMENT ON COLUMN public.vat_returns.total_exempt_purchases IS
  'Exempt purchases for the period. Existing returns remain 0 until reviewed.';

-- ----------------------------------------------------------------------------
-- Extract the pre-tax base from a stored tax_lines JSONB document.
--
-- Supports both canonical invoice shape ({ lines: [...] }) and retail sale
-- shape ({ tax_lines: [...], subtotal_excl_tax }). The minimum positive base
-- across VAT/NHIL/GETFund is the pre-tax base: pre-2026 VAT is compounded on
-- the levies, so the VAT line's base is higher than the levy base.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.extract_tax_line_base(p_tax_lines JSONB)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  WITH raw_lines AS (
    SELECT value AS line
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
    )
  ),
  tax_lines AS (
    SELECT
      line->>'code' AS code,
      CASE
        WHEN jsonb_typeof(line->'meta'->'base') = 'number'
          THEN (line->'meta'->>'base')::NUMERIC
        WHEN jsonb_typeof(line->'base') = 'number'
          THEN (line->>'base')::NUMERIC
      END AS base,
      NULLIF(line->>'rate', '')::NUMERIC AS rate,
      NULLIF(line->>'amount', '')::NUMERIC AS amount
    FROM raw_lines
    WHERE line->>'code' IN ('VAT', 'NHIL', 'GETFUND', 'COVID')
  )
  SELECT COALESCE(
    MIN(CASE WHEN base IS NOT NULL AND base > 0 THEN base END),
    MIN(CASE
      WHEN code IN ('NHIL', 'GETFUND') AND rate > 0 AND amount > 0
        THEN amount / rate
    END),
    MIN(CASE
      WHEN code = 'VAT' AND rate > 0 AND amount > 0
        THEN amount / rate
    END)
  )
  FROM tax_lines;
$$;

COMMENT ON FUNCTION public.extract_tax_line_base(JSONB) IS
  'Returns the pre-tax base from a stored tax_lines document. Returns NULL when the document has no usable base evidence.';

-- ----------------------------------------------------------------------------
-- Read-only extraction of VAT taxable bases for a period.
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
  v_standard_sales NUMERIC := 0;
  v_zero_sales NUMERIC := 0;
  v_exempt_sales NUMERIC := 0;
  v_standard_purchases NUMERIC := 0;
  v_zero_purchases NUMERIC := 0;
  v_exempt_purchases NUMERIC := 0;
  v_credit_note_sales NUMERIC := 0;
  v_ledger_revenue NUMERIC := 0;
  v_unclassified_sales INTEGER := 0;
  v_unclassified_purchases INTEGER := 0;
  v_fallback_sales INTEGER := 0;
  v_fallback_purchases INTEGER := 0;
  v_warnings JSONB := '[]'::JSONB;
BEGIN
  IF p_business_id IS NULL OR p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'business_id, start_date and end_date are required'
      USING ERRCODE = '22023';
  END IF;

  -- Invoice standard-rated sales. Persisted tax-line bases are authoritative.
  SELECT
    COALESCE(SUM(COALESCE(public.extract_tax_line_base(i.tax_lines), i.subtotal)), 0),
    COUNT(*) FILTER (
      WHERE public.extract_tax_line_base(i.tax_lines) IS NULL
        AND COALESCE(i.total_tax, 0) > 0
    )
  INTO v_standard_sales, v_fallback_sales
  FROM public.invoices i
  WHERE i.business_id = p_business_id
    AND i.deleted_at IS NULL
    AND i.issue_date BETWEEN p_start_date AND p_end_date
    AND COALESCE(i.status, '') NOT IN ('draft', 'void', 'cancelled')
    AND (
      public.extract_tax_line_base(i.tax_lines) IS NOT NULL
      OR COALESCE(i.total_tax, 0) > 0
    );

  -- Retail standard-rated sales. Retail tax_lines carry subtotal_excl_tax.
  v_standard_sales := v_standard_sales + COALESCE((
    SELECT SUM(
      COALESCE(
        NULLIF(s.tax_lines->>'subtotal_excl_tax', '')::NUMERIC,
        public.extract_tax_line_base(s.tax_lines)
      )
    )
    FROM public.sales s
    WHERE s.business_id = p_business_id
      AND s.created_at::date BETWEEN p_start_date AND p_end_date
      AND COALESCE(s.payment_status, '') NOT IN ('void', 'cancelled', 'refunded')
      AND s.tax_lines IS NOT NULL
      AND s.tax_lines <> '{}'::JSONB
  ), 0);

  -- Applied customer credit notes reduce standard-rated sales.
  SELECT COALESCE(SUM(public.extract_tax_line_base(cn.tax_lines)), 0)
  INTO v_credit_note_sales
  FROM public.credit_notes cn
  WHERE cn.business_id = p_business_id
    AND cn.deleted_at IS NULL
    AND cn.date BETWEEN p_start_date AND p_end_date
    AND cn.status = 'applied';

  v_standard_sales := GREATEST(v_standard_sales - v_credit_note_sales, 0);

  -- Retail zero-rated and exempt sales are classified by product category.
  SELECT
    COALESCE(SUM(
      CASE WHEN COALESCE(c.vat_type, 'standard') = 'zero'
        THEN si.price * si.qty - COALESCE(si.discount_amount, 0) ELSE 0 END
    ), 0),
    COALESCE(SUM(
      CASE WHEN COALESCE(c.vat_type, 'standard') = 'exempt'
        THEN si.price * si.qty - COALESCE(si.discount_amount, 0) ELSE 0 END
    ), 0)
  INTO v_zero_sales, v_exempt_sales
  FROM public.sales s
  JOIN public.sale_items si ON si.sale_id = s.id
  LEFT JOIN public.products p ON p.id = si.product_id
  LEFT JOIN public.categories c ON c.id = p.category_id
  WHERE s.business_id = p_business_id
    AND s.created_at::date BETWEEN p_start_date AND p_end_date
    AND COALESCE(s.payment_status, '') NOT IN ('void', 'cancelled', 'refunded');

  -- Bill standard-rated purchases.
  SELECT
    COALESCE(SUM(COALESCE(public.extract_tax_line_base(b.tax_lines), b.subtotal)), 0),
    COUNT(*) FILTER (
      WHERE public.extract_tax_line_base(b.tax_lines) IS NULL
        AND COALESCE(b.total_tax, 0) > 0
    )
  INTO v_standard_purchases, v_fallback_purchases
  FROM public.bills b
  WHERE b.business_id = p_business_id
    AND b.deleted_at IS NULL
    AND b.issue_date BETWEEN p_start_date AND p_end_date
    AND COALESCE(b.status, '') <> 'draft'
    AND (
      public.extract_tax_line_base(b.tax_lines) IS NOT NULL
      OR COALESCE(b.total_tax, 0) > 0
    );

  -- Expense input tax: amount is the pre-tax expense base.
  v_standard_purchases := v_standard_purchases + COALESCE((
    SELECT SUM(e.amount)
    FROM public.expenses e
    WHERE e.business_id = p_business_id
      AND e.deleted_at IS NULL
      AND e.date BETWEEN p_start_date AND p_end_date
      AND (
        COALESCE(e.vat, 0) > 0
        OR COALESCE(e.nhil, 0) > 0
        OR COALESCE(e.getfund, 0) > 0
        OR COALESCE(e.covid, 0) > 0
      )
  ), 0);

  -- Unclassified documents: no tax lines and no tax. These may be zero-rated,
  -- exempt, out of scope or simply missing classification. Do not guess.
  SELECT COUNT(*) INTO v_unclassified_sales
  FROM public.invoices i
  WHERE i.business_id = p_business_id
    AND i.deleted_at IS NULL
    AND i.issue_date BETWEEN p_start_date AND p_end_date
    AND COALESCE(i.status, '') NOT IN ('draft', 'void', 'cancelled')
    AND COALESCE(i.total_tax, 0) = 0
    AND COALESCE(i.subtotal, 0) > 0
    AND public.extract_tax_line_base(i.tax_lines) IS NULL;

  SELECT COUNT(*) INTO v_unclassified_purchases
  FROM public.bills b
  WHERE b.business_id = p_business_id
    AND b.deleted_at IS NULL
    AND b.issue_date BETWEEN p_start_date AND p_end_date
    AND COALESCE(b.status, '') <> 'draft'
    AND COALESCE(b.total_tax, 0) = 0
    AND COALESCE(b.subtotal, 0) > 0
    AND public.extract_tax_line_base(b.tax_lines) IS NULL;

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

  IF v_fallback_sales > 0 THEN
    v_warnings := v_warnings || jsonb_build_array(
      format(
        '%s sales document(s) have tax but no persisted tax-line base. Their pre-tax subtotal was used; review the document tax breakdown.',
        v_fallback_sales
      )
    );
  END IF;

  IF v_fallback_purchases > 0 THEN
    v_warnings := v_warnings || jsonb_build_array(
      format(
        '%s purchase document(s) have tax but no persisted tax-line base. Their pre-tax subtotal was used; review the document tax breakdown.',
        v_fallback_purchases
      )
    );
  END IF;

  IF v_unclassified_sales > 0 THEN
    v_warnings := v_warnings || jsonb_build_array(
      format(
        '%s sales document(s) in this period have no tax classification. Zero-rated and exempt supplies cannot be inferred; review those documents before filing.',
        v_unclassified_sales
      )
    );
  END IF;

  IF v_unclassified_purchases > 0 THEN
    v_warnings := v_warnings || jsonb_build_array(
      format(
        '%s purchase document(s) in this period have no tax classification. Zero-rated and exempt purchases cannot be inferred; review those documents before filing.',
        v_unclassified_purchases
      )
    );
  END IF;

  IF ABS((v_standard_sales + v_zero_sales + v_exempt_sales) - v_ledger_revenue) > 0.01 THEN
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
    'warnings', v_warnings
  );
END;
$$;

COMMENT ON FUNCTION public.extract_vat_taxable_bases(UUID, DATE, DATE) IS
  'Read-only VAT taxable-base extraction from persisted tax-line bases, retail category classification and ledger revenue. Returns explicit warnings for unclassified or unreconciled documents.';

REVOKE ALL ON FUNCTION public.extract_tax_line_base(JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extract_tax_line_base(JSONB)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.extract_vat_taxable_bases(UUID, DATE, DATE)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extract_vat_taxable_bases(UUID, DATE, DATE)
  TO authenticated, service_role;
