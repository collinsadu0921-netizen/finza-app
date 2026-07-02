-- Staging smoke for migration 513 (run manually on staging only)
-- business_id: Finza Load Test Services Ltd

SELECT proname
FROM pg_proc
WHERE proname IN (
  'refresh_service_dashboard_period_summaries',
  'try_refresh_service_dashboard_period_summaries',
  'refresh_service_pnl_movement_snapshot',
  'try_refresh_service_pnl_movement_snapshot'
)
ORDER BY 1;

-- 1) Dashboard summary refresh should NOT require P&L line rows
-- SELECT refresh_service_dashboard_period_summaries('4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid, 6);

-- SELECT COUNT(*) AS summary_rows
-- FROM service_dashboard_period_summary
-- WHERE business_id = '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid;

-- 2) P&L snapshot refresh is separate (reports path)
-- SELECT try_refresh_service_pnl_movement_snapshot(
--   '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid,
--   '2026-01-01'::date,
--   '2026-01-31'::date
-- );

-- SELECT COUNT(*) AS pnl_line_rows
-- FROM service_pnl_movement_lines
-- WHERE business_id = '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid;

-- 3) Snapshot lines should match live movement for same period (replace dates):
-- SELECT account_code, period_total
-- FROM get_pnl_movement_lines_from_snapshot(
--   '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid,
--   '2026-01-01'::date,
--   '2026-01-31'::date,
--   300
-- )
-- EXCEPT
-- SELECT account_code, period_total
-- FROM get_profit_and_loss_movement(
--   '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid,
--   '2026-01-01'::date,
--   '2026-01-31'::date
-- );
