-- Staging verification for migration 509 (run in Supabase SQL editor, project adonhhtooawkeemdqqeo)
-- Load-test business: 4e6cdfba-e2ab-4ee4-ac00-9b077d696544

-- 1. Objects exist
SELECT proname, prosecdef AS security_definer
FROM pg_proc
WHERE proname IN (
  'get_service_dashboard_timeline_stale_summary',
  'try_refresh_service_dashboard_period_summaries',
  'refresh_service_dashboard_period_summaries',
  'get_service_dashboard_business_has_ledger_movement',
  'get_service_dashboard_timeline_from_summary'
)
ORDER BY proname;

-- 2. Summary rows (expect >0 after refresh on tenant with ledger)
SELECT period_id, period_start, period_end, revenue, expenses, net_profit, refreshed_at
FROM service_dashboard_period_summary
WHERE business_id = '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'
ORDER BY period_start DESC
LIMIT 12;

-- 3. Journal movement exists
SELECT EXISTS (
  SELECT 1 FROM journal_entries
  WHERE business_id = '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'
  LIMIT 1
) AS has_journal;

-- 4. Blocking refresh (run as authenticated user via app; service role gets access_denied by design)
-- SELECT refresh_service_dashboard_period_summaries('4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid, 12);
