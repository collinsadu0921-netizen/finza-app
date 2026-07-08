-- Staging verification for migration 523 (project adonhhtooawkeemdqqeo only)
-- Run in Supabase SQL Editor after applying 523.

-- Triggers present
SELECT tgname, tgrelid::regclass AS table_name
FROM pg_trigger
WHERE tgname IN (
  'trg_accounting_periods_zero_snapshots',
  'trg_journal_entries_insert_enqueue_snapshot',
  'trg_journal_entry_lines_enqueue_snapshot',
  'trg_journal_entries_enqueue_snapshot'
)
ORDER BY tgname;

-- New period bootstrap writes zero metadata (replace business_id if testing)
-- INSERT INTO accounting_periods (business_id, period_start, period_end, status)
-- VALUES ('<BUSINESS_ID>'::uuid, '2099-01-01', '2099-01-31', 'open');
-- SELECT * FROM service_pnl_movement_snapshots
-- WHERE business_id = '<BUSINESS_ID>'::uuid AND period_start = '2099-01-01';

-- Queue + health (522 + worker)
SELECT status, count(*) FROM accounting_snapshot_refresh_jobs GROUP BY status ORDER BY status;
SELECT get_accounting_snapshot_health();
