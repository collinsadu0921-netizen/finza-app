-- Verification SQL for accounting snapshot read model (522)
-- Run in Supabase SQL Editor (read-only checks).

-- Global snapshot counts
select count(*) as dashboard_summary_rows from service_dashboard_period_summary;
select count(*) as pnl_line_rows from service_pnl_movement_lines;
select count(*) as pnl_metadata_rows from service_pnl_movement_snapshots;

-- Queue health
select status, count(*) from accounting_snapshot_refresh_jobs group by status order by status;
select min(next_run_at) as oldest_pending from accounting_snapshot_refresh_jobs where status = 'pending';

-- RPC health summary (service_role / postgres)
select get_accounting_snapshot_health();

-- Per-business check (replace UUID)
-- select count(*) from service_dashboard_period_summary where business_id = '<BUSINESS_ID>'::uuid;
-- select count(*) from service_pnl_movement_snapshots where business_id = '<BUSINESS_ID>'::uuid;
-- select period_has_live_pnl_movement('<BUSINESS_ID>'::uuid, '2026-05-01', '2026-05-31');
-- select line_count from get_service_pnl_movement_snapshot_metadata('<BUSINESS_ID>'::uuid, '2026-05-01', '2026-05-31', 86400);
