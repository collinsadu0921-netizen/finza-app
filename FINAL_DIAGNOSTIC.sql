-- ============================================================================
-- FINAL DIAGNOSTIC - Show exact values that would be used
-- ============================================================================

WITH test_sale AS (
  SELECT 
    id,
    amount as gross_total,
    tax_lines,
    description
  FROM sales
  WHERE description LIKE '%ROOT CAUSE TEST%'
  ORDER BY created_at DESC
  LIMIT 1
),
extracted AS (
  SELECT 
    id,
    gross_total,
    tax_lines,
    -- Simulate extraction
    CASE 
      WHEN tax_lines IS NOT NULL AND jsonb_typeof(tax_lines) = 'object' AND tax_lines ? 'subtotal_excl_tax'
      THEN (tax_lines->>'subtotal_excl_tax')::numeric
      ELSE NULL
    END as net_total_extracted,
    CASE 
      WHEN tax_lines IS NOT NULL AND jsonb_typeof(tax_lines) = 'object' AND tax_lines ? 'tax_total'
      THEN (tax_lines->>'tax_total')::numeric
      ELSE NULL
    END as tax_total_extracted
  FROM test_sale
),
finalized AS (
  SELECT 
    id,
    gross_total,
    ROUND(gross_total, 2) as gross_total_rounded,
    -- Line 373: net_total := ROUND(COALESCE(net_total, gross_total), 2)
    ROUND(COALESCE(net_total_extracted, gross_total), 2) as net_total_after_373,
    -- Line 374: total_tax_amount := ROUND(COALESCE(total_tax_amount, 0), 2)
    ROUND(COALESCE(tax_total_extracted, 0), 2) as tax_total_after_374,
    -- Line 387: net_total := COALESCE(net_total, 0)  <-- POTENTIAL BUG!
    COALESCE(ROUND(COALESCE(net_total_extracted, gross_total), 2), 0) as net_total_after_387
  FROM extracted
),
account_ids AS (
  SELECT 
    get_account_by_control_key('69278e9a-8694-4640-88d1-cbcfe7dd42f3', 'CASH') as cash_account_id,
    get_account_by_code('69278e9a-8694-4640-88d1-cbcfe7dd42f3', '4000') as revenue_account_id
)
SELECT 
  'ROOT CAUSE DIAGNOSTIC' as section,
  f.id as sale_id,
  f.gross_total_rounded,
  f.net_total_after_373,
  f.net_total_after_387,
  f.tax_total_after_374,
  a.cash_account_id,
  a.revenue_account_id,
  -- Show what the revenue credit would be
  ROUND(COALESCE(f.net_total_after_387, 0), 2) as revenue_credit_value,
  -- Show the journal_lines JSONB that would be built
  jsonb_build_array(
    jsonb_build_object('account_id', a.cash_account_id, 'debit', f.gross_total_rounded, 'description', 'Sale receipt'),
    jsonb_build_object('account_id', a.revenue_account_id, 'credit', ROUND(COALESCE(f.net_total_after_387, 0), 2), 'description', 'Sales revenue')
  ) as journal_lines_jsonb,
  -- Calculate totals
  (SELECT SUM(COALESCE((line->>'debit')::NUMERIC, 0)) FROM jsonb_array_elements(
    jsonb_build_array(
      jsonb_build_object('account_id', a.cash_account_id, 'debit', f.gross_total_rounded, 'description', 'Sale receipt'),
      jsonb_build_object('account_id', a.revenue_account_id, 'credit', ROUND(COALESCE(f.net_total_after_387, 0), 2), 'description', 'Sales revenue')
    )
  ) as line) as calculated_debit,
  (SELECT SUM(COALESCE((line->>'credit')::NUMERIC, 0)) FROM jsonb_array_elements(
    jsonb_build_array(
      jsonb_build_object('account_id', a.cash_account_id, 'debit', f.gross_total_rounded, 'description', 'Sale receipt'),
      jsonb_build_object('account_id', a.revenue_account_id, 'credit', ROUND(COALESCE(f.net_total_after_387, 0), 2), 'description', 'Sales revenue')
    )
  ) as line) as calculated_credit,
  CASE 
    WHEN ROUND(COALESCE(f.net_total_after_387, 0), 2) = 0 THEN 'ERROR: Revenue credit is 0! This is the root cause.'
    ELSE 'OK: Revenue credit has value'
  END as diagnosis
FROM finalized f, account_ids a;
