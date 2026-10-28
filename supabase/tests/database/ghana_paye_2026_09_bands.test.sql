-- ============================================================================
-- Non-production database checks for migration 603 (Act 1178 PAYE bands).
--
-- psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
--   -f supabase/tests/database/ghana_paye_2026_09_bands.test.sql
--
-- All objects/fixtures are inside BEGIN/ROLLBACK.
-- ============================================================================
BEGIN;

DO $test$
DECLARE
  v_case RECORD;
BEGIN
  -- Independently transcribed Act 1178 monthly boundaries.
  FOR v_case IN
    SELECT * FROM (VALUES
      (0::NUMERIC, 0::NUMERIC),
      (587.99, 0),
      (588, 0),
      (588.01, 0),
      (667.99, 4.00),
      (668, 4.00),
      (668.01, 4.00),
      (767.99, 14.00),
      (768, 14.00),
      (768.01, 14.00),
      (3667.99, 521.50),
      (3668, 521.50),
      (3668.01, 521.50),
      (19667.99, 4521.50),
      (19668, 4521.50),
      (19668.01, 4521.50),
      (49999.99, 13621.10),
      (50000, 13621.10),
      (50000.01, 13621.10),
      (60000, 17121.10),
      (100000, 31121.10)
    ) AS cases(taxable, expected)
  LOOP
    IF public.payroll_ghana_calculate_paye_from_bands(
         v_case.taxable, 'gh-paye-2026-09'
       ) IS DISTINCT FROM v_case.expected THEN
      RAISE EXCEPTION
        'Act 1178 PAYE mismatch at %: expected %, got %',
        v_case.taxable,
        v_case.expected,
        public.payroll_ghana_calculate_paye_from_bands(
          v_case.taxable, 'gh-paye-2026-09'
        );
    END IF;
  END LOOP;

  -- Previous schedule remains available for periods through 31 August 2026.
  IF public.payroll_ghana_calculate_paye_from_bands(650, 'gh-paye-2024-01') <> 10.50 THEN
    RAISE EXCEPTION '2024 PAYE mismatch at 650';
  END IF;
  IF public.payroll_ghana_calculate_paye_from_bands(1000, 'gh-paye-2024-01') <> 65.75 THEN
    RAISE EXCEPTION '2024 PAYE mismatch at 1000';
  END IF;

  -- Act 1178 amended the First Schedule without a statutory expiry. The PAYE
  -- schedule therefore remains available for 2027 even though annual SSNIT
  -- limits for 2027 are not yet verified.
  IF public.payroll_ghana_calculate_paye_from_bands(1000, 'gh-paye-2026-09') <> 54.60 THEN
    RAISE EXCEPTION 'Act 1178 PAYE mismatch at 1000';
  END IF;

  -- 2027 uses the latest published 2026 SSNIT limits provisionally.
  IF public.payroll_ghana_confirmed_pension_version_for_period(DATE '2027-01-01') IS NOT NULL THEN
    RAISE EXCEPTION '2027 unexpectedly has a confirmed SSNIT version';
  END IF;
  IF (public.payroll_ghana_expected_pension(
        1000, 'gh-pension-2027-provisional', TRUE
      )->>'employee')::NUMERIC <> 55.00 THEN
    RAISE EXCEPTION 'provisional 2027 SSNIT employee contribution mismatch';
  END IF;

  -- The non-annual casual/non-resident profile-tax rates also remain valid.
  IF NOT public.payroll_ghana_profile_tax_version_covers_period(
    'gh-profile-tax-2024-01', DATE '2027-01-01'
  ) THEN
    RAISE EXCEPTION 'profile-tax version unexpectedly expired for 2027';
  END IF;

  -- The legacy one-argument helper must not silently assume the 2024 schedule.
  BEGIN
    PERFORM public.payroll_ghana_calculate_paye_from_bands(1000);
    RAISE EXCEPTION 'legacy one-argument PAYE helper unexpectedly calculated a value';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'Ghana PAYE version is required%' THEN
        RAISE;
      END IF;
  END;

  -- The new schedule must differ from the old one at the same income.
  IF public.payroll_ghana_calculate_paye_from_bands(945, 'gh-paye-2026-09') <> 44.98 THEN
    RAISE EXCEPTION 'Act 1178 PAYE mismatch at 945';
  END IF;
  IF public.payroll_ghana_calculate_paye_from_bands(945, 'gh-paye-2024-01') <> 56.13 THEN
    RAISE EXCEPTION '2024 PAYE mismatch at 945';
  END IF;

  -- Unknown versions must fail closed instead of falling back to any schedule.
  BEGIN
    PERFORM public.payroll_ghana_calculate_paye_from_bands(1000, 'gh-paye-unknown');
    RAISE EXCEPTION 'unknown PAYE version unexpectedly calculated a value';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'Unrecognized Ghana PAYE rate version%' THEN
        RAISE;
      END IF;
  END;
END
$test$;

ROLLBACK;
