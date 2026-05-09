import type { MapsToBucket } from "@/lib/payroll/allowanceTypeMapping"

export type PayrollAllowanceBucket = "bonus" | "overtime" | "regular"

export type AllowanceBucketInput = {
  type: string | null | undefined
  allowance_type_id?: string | null | undefined
  payroll_allowance_types?: { maps_to_bucket: MapsToBucket } | null | undefined
}

/**
 * Payroll run bucketing for bonus/overtime vs regular totals.
 * When allowance_type_id links to payroll_allowance_types, maps_to_bucket wins.
 * Otherwise falls back to legacy allowances.type ('bonus', 'overtime', else regular).
 *
 * NOTE: taxable / pensionable on payroll_allowance_types are persisted for future
 * Ghana allowance treatment but not read here yet.
 */
export function effectiveAllowanceBucket(row: AllowanceBucketInput): PayrollAllowanceBucket {
  const fromPat = row.payroll_allowance_types?.maps_to_bucket
  if (fromPat === "bonus") return "bonus"
  if (fromPat === "overtime") return "overtime"
  if (fromPat === "regular") return "regular"

  const t = String(row.type ?? "").trim().toLowerCase()
  if (t === "bonus") return "bonus"
  if (t === "overtime") return "overtime"
  return "regular"
}
