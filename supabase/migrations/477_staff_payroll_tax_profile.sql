-- Phase 0: staff-level payroll tax profile for Ghana PAYE / GRA export readiness.
-- Defaults preserve prior behaviour (resident + pensionable) for existing rows.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS is_tax_resident boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_pensionable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS gra_position_code text,
  ADD COLUMN IF NOT EXISTS secondary_employment boolean NOT NULL DEFAULT false;

ALTER TABLE public.staff
  DROP CONSTRAINT IF EXISTS staff_gra_position_code_chk;

ALTER TABLE public.staff
  DROP CONSTRAINT IF EXISTS staff_gra_position_code_allowed_chk;

ALTER TABLE public.staff
  ADD CONSTRAINT staff_gra_position_code_chk
  CHECK (
    gra_position_code IS NULL
    OR gra_position_code IN ('EXPT', 'JUNR', 'MNGT', 'OTHR', 'SENR')
  );

COMMENT ON COLUMN public.staff.is_tax_resident IS 'Ghana PAYE: tax resident when true; non-resident when false.';
COMMENT ON COLUMN public.staff.is_pensionable IS 'When false, employee/employer SSNIT-style pension is not calculated for this staff.';
COMMENT ON COLUMN public.staff.gra_position_code IS 'Optional GRA employee position code for PAYE uploads (EXPT, JUNR, MNGT, OTHR, SENR).';
COMMENT ON COLUMN public.staff.secondary_employment IS 'Whether employee has secondary employment (GRA reporting).';
