-- ============================================================================
-- QUICK CAPTURE: Run This IMMEDIATELY After TEST A/B/C Execution
-- ============================================================================
-- Purpose: Capture journal_lines JSONB for most recent test sales
-- ============================================================================

-- ============================================================================
-- Option 1: Get Most Recent Debug Log Entries (Last 5 minutes)
-- ============================================================================

SELECT
  id AS log_id,
  created_at,
  sale_id,
  -- Critical: The actual journal_lines JSONB
  journal_lines,
  -- Summary stats
  line_count,
  debit_sum,
  credit_sum,
  credit_count,
  tax_shape,
  -- For reference
  gross_total,
  net_total,
  total_tax_amount
FROM retail_posting_debug_log
WHERE created_at >= NOW() - INTERVAL '5 minutes'
ORDER BY created_at DESC
LIMIT 10;

-- ============================================================================
-- Option 2: Get journal_lines JSONB as TEXT (Easy Copy/Paste)
-- ============================================================================

SELECT
  sale_id,
  created_at,
  journal_lines::text AS journal_lines_text,
  debit_sum,
  credit_sum,
  line_count
FROM retail_posting_debug_log
WHERE created_at >= NOW() - INTERVAL '5 minutes'
ORDER BY created_at DESC
LIMIT 10;

-- ============================================================================
-- Option 3: Detailed Line-by-Line for Most Recent 3 Entries
-- ============================================================================

WITH recent_logs AS (
  SELECT 
    id,
    sale_id,
    journal_lines,
    created_at,
    debit_sum,
    credit_sum,
    line_count
  FROM retail_posting_debug_log
  WHERE created_at >= NOW() - INTERVAL '5 minutes'
    AND journal_lines IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 3
)
SELECT
  rl.sale_id,
  rl.created_at,
  rl.line_count,
  rl.debit_sum,
  rl.credit_sum,
  line_num.idx AS line_number,
  line_num.line->>'account_id' AS account_id,
  line_num.line->>'debit' AS debit,
  line_num.line->>'credit' AS credit,
  line_num.line->>'description' AS description
FROM recent_logs rl
CROSS JOIN LATERAL jsonb_array_elements(rl.journal_lines) WITH ORDINALITY AS line_num(line, idx)
ORDER BY rl.created_at DESC, line_num.idx;

-- ============================================================================
-- Option 4: Find Test Sales by Description Pattern
-- ============================================================================

SELECT
  d.sale_id,
  s.description AS sale_description,
  d.created_at,
  d.journal_lines,
  d.debit_sum,
  d.credit_sum,
  d.credit_count,
  d.tax_shape
FROM retail_posting_debug_log d
JOIN sales s ON s.id = d.sale_id
WHERE d.created_at >= NOW() - INTERVAL '10 minutes'
  AND (
    s.description LIKE '%TEST%' 
    OR s.description LIKE '%Canonical%'
    OR s.description LIKE '%Parsed%'
    OR s.description LIKE '%NULL%'
  )
ORDER BY d.created_at DESC;
