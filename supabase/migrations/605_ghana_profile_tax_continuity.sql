-- ============================================================================
-- Migration 605: Keep non-annual Ghana profile-tax rates valid after 2026
--
-- Act 1178 amended the resident graduated PAYE schedule. The casual-worker,
-- non-resident and non-resident bonus/overtime rates are unchanged statutory
-- rates and are not annual budget values. The previous Finza support-end date
-- was an internal verification window, not a statutory expiry. Removing that
-- upper bound ensures January 2027 payroll is not blocked by the PAYE rules.
--
-- Annual SSNIT minimum/maximum insurable earnings remain year-specific and are
-- still verified only through 2026-12-31. Pension resolution continues to fail
-- closed until the next SSNIT annual notice is added.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.payroll_ghana_profile_tax_version_covers_period(
  p_version TEXT,
  p_period DATE
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(
    p_version = 'gh-profile-tax-2024-01'
    AND p_period >= DATE '2024-01-01',
    FALSE
  )
$fn$;

COMMENT ON FUNCTION public.payroll_ghana_profile_tax_version_covers_period(TEXT, DATE) IS
  'Checks the non-annual Ghana casual/non-resident profile-tax version. It has no upper date; annual SSNIT limits are handled separately.';

REVOKE ALL ON FUNCTION public.payroll_ghana_profile_tax_version_covers_period(TEXT, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_profile_tax_version_covers_period(TEXT, DATE)
  TO postgres;
