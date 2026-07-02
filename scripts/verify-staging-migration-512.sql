-- Staging smoke for migration 512 (run manually on staging only)
-- business_id: Finza Load Test Services Ltd

SELECT proname
FROM pg_proc
WHERE proname IN (
  'get_fresh_service_dashboard_period_pnl',
  'get_pnl_movement_lines_from_snapshot',
  '_upsert_service_pnl_movement_lines'
)
ORDER BY 1;

SELECT COUNT(*) AS line_rows
FROM service_pnl_movement_lines
WHERE business_id = '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid;

-- Populate summaries + line snapshots (blocking):
-- SELECT refresh_service_dashboard_period_summaries('4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid, 6);

-- Compare fresh summary vs live totals for current period (replace dates):
-- SELECT * FROM get_fresh_service_dashboard_period_pnl(
--   '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid,
--   '2026-01-01'::date,
--   '2026-01-31'::date,
--   300
-- );
