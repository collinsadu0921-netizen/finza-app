-- Ghana payroll component snapshot support:
-- 1) allow overtime as an allowance type
-- 2) persist bonus/overtime tax breakdown fields on payroll_entries

ALTER TABLE allowances
  DROP CONSTRAINT IF EXISTS allowances_type_check;

ALTER TABLE allowances
  ADD CONSTRAINT allowances_type_check
  CHECK (type IN ('transport', 'housing', 'utility', 'medical', 'bonus', 'overtime', 'other'));

ALTER TABLE payroll_entries
  ADD COLUMN IF NOT EXISTS regular_allowances_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_tax_5 NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_tax_graduated NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_tax_5 NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_tax_10 NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_tax_graduated NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_qualifying_junior_employee BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bonus_cap_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_threshold_amount NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE payroll_entries
  DROP CONSTRAINT IF EXISTS payroll_entries_bonus_overtime_non_negative_chk;

ALTER TABLE payroll_entries
  ADD CONSTRAINT payroll_entries_bonus_overtime_non_negative_chk
  CHECK (
    regular_allowances_amount >= 0 AND
    bonus_amount >= 0 AND
    overtime_amount >= 0 AND
    bonus_tax_5 >= 0 AND
    bonus_tax_graduated >= 0 AND
    overtime_tax_5 >= 0 AND
    overtime_tax_10 >= 0 AND
    overtime_tax_graduated >= 0 AND
    bonus_cap_amount >= 0 AND
    overtime_threshold_amount >= 0
  );
