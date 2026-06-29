-- Phase 1 CIT hardening: period metadata, due dates, and duplicate protection.
-- Backward-compatible: historical rows without period_start/period_end are ignored
-- by the partial unique index.

ALTER TABLE public.cit_provisions
  ADD COLUMN IF NOT EXISTS fiscal_year INT,
  ADD COLUMN IF NOT EXISTS quarter INT CHECK (quarter IS NULL OR quarter BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS period_start DATE,
  ADD COLUMN IF NOT EXISTS period_end DATE,
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS profit_before_tax NUMERIC(15,2);

CREATE INDEX IF NOT EXISTS idx_cit_provisions_business_due_date
  ON public.cit_provisions (business_id, due_date)
  WHERE due_date IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cit_provisions_business_period_type_unique
  ON public.cit_provisions (business_id, provision_type, period_start, period_end)
  WHERE period_start IS NOT NULL
    AND period_end IS NOT NULL;

COMMENT ON COLUMN public.cit_provisions.fiscal_year IS
  'Calendar fiscal year for Phase 1 Ghana CIT metadata. Future fiscal-year customization may alter derivation.';

COMMENT ON COLUMN public.cit_provisions.quarter IS
  'Calendar quarter number for quarterly Ghana CIT provisions; null for annual/final provisions.';

COMMENT ON COLUMN public.cit_provisions.period_start IS
  'Inclusive start date of the CIT provision period.';

COMMENT ON COLUMN public.cit_provisions.period_end IS
  'Inclusive end date of the CIT provision period.';

COMMENT ON COLUMN public.cit_provisions.due_date IS
  'Current Ghana CIT due date derived from calendar-year Phase 1 rules.';

COMMENT ON COLUMN public.cit_provisions.profit_before_tax IS
  'Snapshot of the P&L profit-before-tax used when deriving the provision, when available.';

COMMENT ON INDEX public.cit_provisions_business_period_type_unique IS
  'Prevents duplicate CIT provisions for the same business, provision type, and dated period while preserving historical rows without period dates.';
