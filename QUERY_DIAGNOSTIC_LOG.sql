-- ============================================================================
-- QUERY DIAGNOSTIC LOG
-- ============================================================================
-- This shows the actual journal_lines JSONB that was passed to post_journal_entry

SELECT 
  sale_id,
  gross_total,
  net_total,
  total_tax_amount,
  journal_lines,
  cash_account_id,
  revenue_account_id,
  cogs_account_id,
  inventory_account_id,
  -- Calculate totals from journal_lines (same as post_journal_entry does)
  (SELECT SUM(COALESCE((line->>'debit')::NUMERIC, 0)) FROM jsonb_array_elements(journal_lines) as line) as calculated_debit,
  (SELECT SUM(COALESCE((line->>'credit')::NUMERIC, 0)) FROM jsonb_array_elements(journal_lines) as line) as calculated_credit,
  -- Show each line individually
  (SELECT jsonb_agg(jsonb_build_object(
    'account_id', line->>'account_id',
    'debit', COALESCE((line->>'debit')::NUMERIC, 0),
    'credit', COALESCE((line->>'credit')::NUMERIC, 0),
    'description', line->>'description'
  )) FROM jsonb_array_elements(journal_lines) as line) as line_details
FROM diagnostic_journal_lines_log
ORDER BY created_at DESC
LIMIT 1;
