-- ============================================================================
-- Accounting snapshot reliability (523) — staging apply first
-- ============================================================================
-- Closes gaps in 522:
--   • journal_entries INSERT → enqueue refresh (lines-only path missed bare JE)
--   • accounting_periods INSERT → zero-state snapshots (ensure_accounting_period)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Zero snapshots when a new accounting period row is created
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_write_zero_snapshots_for_new_period()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.finza_worker_write_zero_period_snapshots(
    NEW.business_id,
    NEW.period_start,
    NEW.period_end
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_write_zero_snapshots_for_new_period IS
  'After INSERT on accounting_periods: bootstrap zero dashboard + P&L snapshots (523).';

DROP TRIGGER IF EXISTS trg_accounting_periods_zero_snapshots ON public.accounting_periods;
CREATE TRIGGER trg_accounting_periods_zero_snapshots
  AFTER INSERT ON public.accounting_periods
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_write_zero_snapshots_for_new_period();

-- ---------------------------------------------------------------------------
-- 2. journal_entries INSERT → enqueue (posting often inserts JE then lines)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_journal_entries_insert_enqueue_snapshot ON public.journal_entries;
CREATE TRIGGER trg_journal_entries_insert_enqueue_snapshot
  AFTER INSERT ON public.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enqueue_snapshot_refresh_from_journal();

COMMENT ON TRIGGER trg_journal_entries_insert_enqueue_snapshot ON public.journal_entries IS
  'Enqueue snapshot refresh when a journal entry is created (523).';
