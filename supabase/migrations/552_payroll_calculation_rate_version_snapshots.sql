-- ============================================================================
-- Migration 552: Payroll calculation / statutory rate version snapshots
-- ============================================================================
-- Additive only. Historical rows keep NULL (= unknown / legacy — not finza-ghana-v2).
-- Do not backfill old runs with a version that was not actually used.
-- ============================================================================

ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS calculation_engine_version TEXT,
  ADD COLUMN IF NOT EXISTS paye_rate_version TEXT,
  ADD COLUMN IF NOT EXISTS pension_rate_version TEXT,
  ADD COLUMN IF NOT EXISTS calculation_jurisdiction TEXT,
  ADD COLUMN IF NOT EXISTS statutory_period_basis DATE;

ALTER TABLE public.payroll_entries
  ADD COLUMN IF NOT EXISTS calculation_engine_version TEXT,
  ADD COLUMN IF NOT EXISTS paye_rate_version TEXT,
  ADD COLUMN IF NOT EXISTS pension_rate_version TEXT,
  ADD COLUMN IF NOT EXISTS calculation_jurisdiction TEXT,
  ADD COLUMN IF NOT EXISTS statutory_period_basis DATE;

COMMENT ON COLUMN public.payroll_runs.calculation_engine_version IS
  'Immutable calculation engine id used for this run (e.g. finza-ghana-v2). NULL = legacy/unknown.';
COMMENT ON COLUMN public.payroll_runs.paye_rate_version IS
  'Immutable PAYE rate table version selected for this run. NULL = legacy/unknown.';
COMMENT ON COLUMN public.payroll_runs.pension_rate_version IS
  'Immutable pension/SSNIT rate table version selected for this run. NULL = legacy/unknown.';
COMMENT ON COLUMN public.payroll_runs.calculation_jurisdiction IS
  'Jurisdiction code used for calculation (e.g. GH). NULL = legacy/unknown.';
COMMENT ON COLUMN public.payroll_runs.statutory_period_basis IS
  'Payroll-period date used to select statutory versions. NULL = legacy/unknown.';

COMMENT ON COLUMN public.payroll_entries.calculation_engine_version IS
  'Per-entry engine version snapshot. NULL = legacy/unknown.';
COMMENT ON COLUMN public.payroll_entries.paye_rate_version IS
  'Per-entry PAYE rate version snapshot. NULL = legacy/unknown.';
COMMENT ON COLUMN public.payroll_entries.pension_rate_version IS
  'Per-entry pension rate version snapshot. NULL = legacy/unknown.';
COMMENT ON COLUMN public.payroll_entries.calculation_jurisdiction IS
  'Per-entry jurisdiction snapshot. NULL = legacy/unknown.';
COMMENT ON COLUMN public.payroll_entries.statutory_period_basis IS
  'Per-entry period basis used for version selection. NULL = legacy/unknown.';
