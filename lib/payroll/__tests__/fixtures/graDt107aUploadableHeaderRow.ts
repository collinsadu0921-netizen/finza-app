/**
 * GRA DT 0107A / DT 0108A **uploadable** employee CSV — official `TABLE DATA` header row (27 columns).
 * Copied from GRA template v1 for regression tests only. **Not read at runtime** from `.local/`.
 *
 * When GRA publishes a new template, update this array and `GRA_DT107A_PAYE_HEADER_ROW` in
 * `lib/payroll/graDt107aPayeExport.ts` together (tests assert they match).
 */
export const GRA_DT0107A_0108A_UPLOADABLE_HEADER_ROW: readonly string[] = [
  "(3) TIN",
  "(2) Employee Name",
  "(1) Serial Number",
  "(4) Position",
  "(5) Non-Resident",
  "(6) Basic Salary",
  "(7) Secondary Employment",
  "(8) Social Security Fund",
  "(9) Third Tier Pension",
  "(10) Cash Allowances",
  "(11) Bonus Income",
  "(12) Final Tax on Bonus",
  "(13) Excess Bonus",
  "(14) Total Cash Emolument",
  "(15) Accommodation Element",
  "(16) Vehicle Element",
  "(17) Non Cash Benefit",
  "(18) Total Assessable Income",
  "(19) Deductible Reliefs",
  "(20) Total Reliefs",
  "(21) Chargeable Income",
  "(22) Tax Deductible",
  "(23) Overtime Income",
  "(24) Overtime Tax",
  "(25) Total Tax Payable to GRA",
  "(26) Severance Pay Paid",
  "(27) Remarks ",
] as const
