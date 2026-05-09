import type { AllowanceType } from "@/lib/payrollTypes"

/** Maps payroll_allowance_types.maps_to_bucket (+ code) onto legacy allowances.type CHECK values. */
const LEGACY_REGULAR_CODES = new Set(["transport", "housing", "utility", "medical"])

export type MapsToBucket = "regular" | "bonus" | "overtime"

export type PayrollAllowanceTypeRowLike = {
  maps_to_bucket: MapsToBucket
  code?: string | null
}

/** Derives the legacy allowance `type` column from a payroll allowance type definition. */
export function deriveLegacyAllowanceType(pat: PayrollAllowanceTypeRowLike): AllowanceType {
  if (pat.maps_to_bucket === "bonus") return "bonus"
  if (pat.maps_to_bucket === "overtime") return "overtime"
  const c = String(pat.code ?? "")
    .trim()
    .toLowerCase()
  if (LEGACY_REGULAR_CODES.has(c)) return c as AllowanceType
  if (c === "other") return "other"
  return "other"
}
