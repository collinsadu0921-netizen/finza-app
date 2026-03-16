-- ============================================================================
-- SHOW JOURNAL_LINES ISSUE - Direct Query Version
-- ============================================================================
-- This queries the database directly to show what's happening

-- Get the test sale and show its data
SELECT 
  'TEST SALE DATA' as section,
  id as sale_id,
  amount as gross_total,
  tax_lines,
  jsonb_typeof(tax_lines) as tax_lines_type,
  CASE 
    WHEN tax_lines IS NOT NULL AND jsonb_typeof(tax_lines) = 'object' 
    THEN tax_lines->>'subtotal_excl_tax'
    ELSE NULL
  END as extracted_subtotal_excl_tax,
  CASE 
    WHEN tax_lines IS NOT NULL AND jsonb_typeof(tax_lines) = 'object' 
    THEN tax_lines->>'tax_total'
    ELSE NULL
  END as extracted_tax_total,
  CASE 
    WHEN tax_lines IS NOT NULL AND jsonb_typeof(tax_lines) = 'object' 
    THEN tax_lines->'tax_lines'
    ELSE NULL
  END as extracted_tax_lines_array,
  description
FROM sales
WHERE description LIKE '%ROOT CAUSE TEST%'
ORDER BY created_at DESC
LIMIT 1;

-- Show what net_total and total_tax_amount should be
WITH sale_data AS (
  SELECT 
    id,
    amount as gross_total,
    tax_lines
  FROM sales
  WHERE description LIKE '%ROOT CAUSE TEST%'
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT 
  'CALCULATED VALUES' as section,
  gross_total,
  CASE 
    WHEN tax_lines IS NOT NULL AND jsonb_typeof(tax_lines) = 'object' AND tax_lines ? 'subtotal_excl_tax'
    THEN ROUND(COALESCE((tax_lines->>'subtotal_excl_tax')::numeric, 0), 2)
    ELSE ROUND(gross_total, 2)
  END as calculated_net_total,
  CASE 
    WHEN tax_lines IS NOT NULL AND jsonb_typeof(tax_lines) = 'object' AND tax_lines ? 'tax_total'
    THEN ROUND(COALESCE((tax_lines->>'tax_total')::numeric, 0), 2)
    ELSE 0
  END as calculated_tax_total,
  CASE 
    WHEN tax_lines IS NOT NULL AND jsonb_typeof(tax_lines) = 'object' AND tax_lines ? 'tax_lines'
    THEN jsonb_array_length(tax_lines->'tax_lines')
    ELSE 0
  END as tax_lines_array_length
FROM sale_data;

-- Show account IDs that should be used
SELECT 
  'ACCOUNT IDs' as section,
  get_account_by_control_key('69278e9a-8694-4640-88d1-cbcfe7dd42f3', 'CASH') as cash_account_id,
  get_account_by_code('69278e9a-8694-4640-88d1-cbcfe7dd42f3', '4000') as revenue_account_id,
  get_account_by_code('69278e9a-8694-4640-88d1-cbcfe7dd42f3', '5000') as cogs_account_id,
  get_account_by_code('69278e9a-8694-4640-88d1-cbcfe7dd42f3', '1200') as inventory_account_id,
  get_account_by_code('69278e9a-8694-4640-88d1-cbcfe7dd42f3', '2100') as vat_account_id;

-- Show what the journal_lines JSONB SHOULD look like (reconstructed)
WITH sale_data AS (
  SELECT 
    id,
    amount as gross_total,
    tax_lines,
    ROUND(amount, 2) as gross_total_rounded,
    CASE 
      WHEN tax_lines IS NOT NULL AND jsonb_typeof(tax_lines) = 'object' AND tax_lines ? 'subtotal_excl_tax'
      THEN ROUND(COALESCE((tax_lines->>'subtotal_excl_tax')::numeric, 0), 2)
      ELSE ROUND(amount, 2)
    END as net_total,
    CASE 
      WHEN tax_lines IS NOT NULL AND jsonb_typeof(tax_lines) = 'object' AND tax_lines ? 'tax_total'
      THEN ROUND(COALESCE((tax_lines->>'tax_total')::numeric, 0), 2)
      ELSE 0
    END as total_tax_amount
  FROM sales
  WHERE description LIKE '%ROOT CAUSE TEST%'
  ORDER BY created_at DESC
  LIMIT 1
),
account_ids AS (
  SELECT 
    get_account_by_control_key('69278e9a-8694-4640-88d1-cbcfe7dd42f3', 'CASH') as cash_account_id,
    get_account_by_code('69278e9a-8694-4640-88d1-cbcfe7dd42f3', '4000') as revenue_account_id,
    get_account_by_code('69278e9a-8694-4640-88d1-cbcfe7dd42f3', '5000') as cogs_account_id,
    get_account_by_code('69278e9a-8694-4640-88d1-cbcfe7dd42f3', '1200') as inventory_account_id
)
SELECT 
  'RECONSTRUCTED JOURNAL_LINES' as section,
  jsonb_build_array(
    jsonb_build_object(
      'account_id', a.cash_account_id,
      'debit', s.gross_total_rounded,
      'description', 'Sale receipt'
    ),
    jsonb_build_object(
      'account_id', a.revenue_account_id,
      'credit', s.net_total,
      'description', 'Sales revenue'
    ),
    jsonb_build_object(
      'account_id', a.cogs_account_id,
      'debit', 0,
      'description', 'Cost of goods sold'
    ),
    jsonb_build_object(
      'account_id', a.inventory_account_id,
      'credit', 0,
      'description', 'Inventory reduction'
    )
  ) as initial_journal_lines,
  s.gross_total_rounded as total_debit_should_be,
  s.net_total as total_credit_should_be,
  s.total_tax_amount as tax_credit_should_be_added,
  s.gross_total_rounded - s.net_total as difference_before_tax
FROM sale_data s, account_ids a;

-- Show what post_journal_entry would calculate from the JSONB
WITH sale_data AS (
  SELECT 
    id,
    amount as gross_total,
    tax_lines,
    ROUND(amount, 2) as gross_total_rounded,
    CASE 
      WHEN tax_lines IS NOT NULL AND jsonb_typeof(tax_lines) = 'object' AND tax_lines ? 'subtotal_excl_tax'
      THEN ROUND(COALESCE((tax_lines->>'subtotal_excl_tax')::numeric, 0), 2)
      ELSE ROUND(amount, 2)
    END as net_total,
    CASE 
      WHEN tax_lines IS NOT NULL AND jsonb_typeof(tax_lines) = 'object' AND tax_lines ? 'tax_total'
      THEN ROUND(COALESCE((tax_lines->>'tax_total')::numeric, 0), 2)
      ELSE 0
    END as total_tax_amount
  FROM sales
  WHERE description LIKE '%ROOT CAUSE TEST%'
  ORDER BY created_at DESC
  LIMIT 1
),
account_ids AS (
  SELECT 
    get_account_by_control_key('69278e9a-8694-4640-88d1-cbcfe7dd42f3', 'CASH') as cash_account_id,
    get_account_by_code('69278e9a-8694-4640-88d1-cbcfe7dd42f3', '4000') as revenue_account_id,
    get_account_by_code('69278e9a-8694-4640-88d1-cbcfe7dd42f3', '5000') as cogs_account_id,
    get_account_by_code('69278e9a-8694-4640-88d1-cbcfe7dd42f3', '1200') as inventory_account_id
),
journal_lines_jsonb AS (
  SELECT jsonb_build_array(
    jsonb_build_object('account_id', a.cash_account_id, 'debit', s.gross_total_rounded, 'description', 'Sale receipt'),
    jsonb_build_object('account_id', a.revenue_account_id, 'credit', s.net_total, 'description', 'Sales revenue'),
    jsonb_build_object('account_id', a.cogs_account_id, 'debit', 0, 'description', 'Cost of goods sold'),
    jsonb_build_object('account_id', a.inventory_account_id, 'credit', 0, 'description', 'Inventory reduction')
  ) as lines
  FROM sale_data s, account_ids a
)
SELECT 
  'CALCULATED TOTALS (as post_journal_entry would)' as section,
  SUM(COALESCE((line->>'debit')::NUMERIC, 0)) as total_debit,
  SUM(COALESCE((line->>'credit')::NUMERIC, 0)) as total_credit,
  SUM(COALESCE((line->>'debit')::NUMERIC, 0)) - SUM(COALESCE((line->>'credit')::NUMERIC, 0)) as difference,
  COUNT(*) as line_count
FROM journal_lines_jsonb j, jsonb_array_elements(j.lines) as line;
