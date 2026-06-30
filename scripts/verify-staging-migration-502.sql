-- Staging verification for migration 502 (run in Supabase SQL editor, project adonhhtooawkeemdqqeo)
-- Expected after 502: still_uses_full_bs = false, both indexes present, timeline uses single-pass pattern.

-- 1) Indexes from 502
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_journal_entries_business_created_at',
    'idx_accounts_business_code_cash'
  )
ORDER BY indexname;

-- 2) finza_dashboard_positions_as_of must NOT call get_balance_sheet_as_of
SELECT
  p.proname,
  pg_get_functiondef(p.oid) LIKE '%get_balance_sheet_as_of%' AS still_uses_full_bs,
  length(pg_get_functiondef(p.oid)) AS def_len
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'finza_dashboard_positions_as_of';

-- 3) timeline should use bounds CTE / single movement pass (502+ pattern)
SELECT
  p.proname,
  pg_get_functiondef(p.oid) LIKE '%bounds AS%' AS has_bounds_cte,
  pg_get_functiondef(p.oid) LIKE '%ordered_periods op%LEFT JOIN movement%' AS has_single_pass_join
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_service_dashboard_timeline';

-- 4) RPC smoke (load-test business) — run 5×; all should succeed quickly
SELECT public.get_service_dashboard_metrics(
  '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid,
  (SELECT period_start FROM accounting_periods
   WHERE business_id = '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid
   ORDER BY period_start DESC LIMIT 1),
  (SELECT period_end FROM accounting_periods
   WHERE business_id = '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid
   ORDER BY period_start DESC LIMIT 1),
  CURRENT_DATE,
  NULL,
  NULL
) AS metrics_sample;

-- 5) EXPLAIN inner helpers (replace dates with current period from your tenant)
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT *
FROM finza_dashboard_pnl_totals(
  '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid,
  (SELECT period_start FROM accounting_periods
   WHERE business_id = '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid
   ORDER BY period_start DESC LIMIT 1),
  (SELECT period_end FROM accounting_periods
   WHERE business_id = '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid
   ORDER BY period_start DESC LIMIT 1)
);

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT *
FROM finza_dashboard_positions_as_of(
  '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid,
  CURRENT_DATE
);

-- 6) Active query pressure during load test (run while workday_50 is active)
SELECT pid, state, wait_event_type, wait_event,
       now() - query_start AS age,
       left(query, 120) AS query_preview
FROM pg_stat_activity
WHERE datname = current_database()
  AND state <> 'idle'
  AND pid <> pg_backend_pid()
ORDER BY query_start
LIMIT 20;

-- 7) After migration 503: get_service_dashboard_metrics should be LANGUAGE sql (single-pass)
SELECT
  p.proname,
  l.lanname AS language,
  pg_get_functiondef(p.oid) LIKE '%period_agg AS%' AS has_period_agg,
  pg_get_functiondef(p.oid) LIKE '%FROM journal_entries je%INNER JOIN journal_entry_lines%' AS journal_first
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
  AND p.proname = 'get_service_dashboard_metrics';
