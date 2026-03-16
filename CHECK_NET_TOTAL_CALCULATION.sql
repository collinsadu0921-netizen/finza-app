-- ============================================================================
-- CHECK NET_TOTAL CALCULATION
-- ============================================================================
-- This checks what net_total should be based on the actual sale data

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
extracted_values AS (
  SELECT 
    id,
    gross_total,
    tax_lines,
    description,
    -- Simulate the extraction logic from the function
    CASE 
      WHEN tax_lines IS NOT NULL AND jsonb_typeof(tax_lines) = 'object' AND tax_lines ? 'subtotal_excl_tax'
      THEN (tax_lines->>'subtotal_excl_tax')::numeric
      ELSE NULL
    END as extracted_subtotal_excl_tax,
    CASE 
      WHEN tax_lines IS NOT NULL AND jsonb_typeof(tax_lines) = 'object' AND tax_lines ? 'tax_total'
      THEN (tax_lines->>'tax_total')::numeric
      ELSE NULL
    END as extracted_tax_total
  FROM test_sale
),
calculated_values AS (
  SELECT 
    id,
    gross_total,
    tax_lines,
    description,
    extracted_subtotal_excl_tax,
    extracted_tax_total,
    -- Simulate line 373: net_total := ROUND(COALESCE(net_total, gross_total), 2)
    ROUND(COALESCE(extracted_subtotal_excl_tax, gross_total), 2) as net_total_after_line_373,
    -- Simulate line 374: total_tax_amount := ROUND(COALESCE(total_tax_amount, 0), 2)
    ROUND(COALESCE(extracted_tax_total, 0), 2) as total_tax_amount_after_line_374,
    -- Simulate line 379-382: Recalculate if imbalance
    CASE 
      WHEN ABS(gross_total - (ROUND(COALESCE(extracted_subtotal_excl_tax, gross_total), 2) + ROUND(COALESCE(extracted_tax_total, 0), 2))) > 0.01
      THEN ROUND(gross_total - ROUND(COALESCE(extracted_tax_total, 0), 2), 2)
      ELSE ROUND(COALESCE(extracted_subtotal_excl_tax, gross_total), 2)
    END as net_total_after_rebalance,
    -- Simulate line 387: net_total := COALESCE(net_total, 0)  <-- THIS IS THE PROBLEM!
    COALESCE(
      CASE 
        WHEN ABS(gross_total - (ROUND(COALESCE(extracted_subtotal_excl_tax, gross_total), 2) + ROUND(COALESCE(extracted_tax_total, 0), 2))) > 0.01
        THEN ROUND(gross_total - ROUND(COALESCE(extracted_tax_total, 0), 2), 2)
        ELSE ROUND(COALESCE(extracted_subtotal_excl_tax, gross_total), 2)
      END,
      0
    ) as net_total_after_line_387
  FROM extracted_values
)
SELECT 
  'DIAGNOSTIC: NET_TOTAL CALCULATION' as section,
  id as sale_id,
  gross_total,
  extracted_subtotal_excl_tax,
  extracted_tax_total,
  net_total_after_line_373,
  total_tax_amount_after_line_374,
  net_total_after_rebalance,
  net_total_after_line_387,
  CASE 
    WHEN net_total_after_line_387 = 0 THEN 'ERROR: net_total is 0! This explains why credits are 0.'
    WHEN net_total_after_line_387 IS NULL THEN 'ERROR: net_total is NULL!'
    ELSE 'OK: net_total has a value'
  END as status,
  -- Show what the revenue credit should be
  net_total_after_line_387 as revenue_credit_should_be,
  -- Show what the journal_lines JSONB should contain
  jsonb_build_array(
    jsonb_build_object('account_id', get_account_by_control_key('69278e9a-8694-4640-88d1-cbcfe7dd42f3', 'CASH'), 'debit', gross_total, 'description', 'Sale receipt'),
    jsonb_build_object('account_id', get_account_by_code('69278e9a-8694-4640-88d1-cbcfe7dd42f3', '4000'), 'credit', net_total_after_line_387, 'description', 'Sales revenue')
  ) as what_journal_lines_should_be
FROM calculated_values;
