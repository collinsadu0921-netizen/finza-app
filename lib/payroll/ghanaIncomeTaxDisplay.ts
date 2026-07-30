import type { GhanaIncomeTaxMethod } from "@/lib/payrollEngine/jurisdictions/ghanaProfileTax"
import { normalizeEmploymentTypeForSnapshot } from "@/lib/payroll/staffTaxProfile"

export type GhanaIncomeTaxEntryFields = {
  income_tax_method?: string | null
  income_tax_method_version?: string | null
  income_tax_regular_base?: number | null
  income_tax_regular_amount?: number | null
  income_tax_bonus_base?: number | null
  income_tax_bonus_amount?: number | null
  income_tax_overtime_base?: number | null
  income_tax_overtime_amount?: number | null
  paye?: number | null
  bonus_tax_5?: number | null
  bonus_tax_graduated?: number | null
  overtime_tax_5?: number | null
  overtime_tax_10?: number | null
  overtime_tax_graduated?: number | null
}

const GHANA_INCOME_TAX_METHOD_LABELS: Record<GhanaIncomeTaxMethod, string> = {
  gh_resident_graduated: "Resident graduated PAYE",
  gh_casual_flat_5: "Casual flat 5% PAYE",
  gh_nonresident_split_25_20: "Non-resident 25% / 20% PAYE",
}

export const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  full_time: "Full time",
  part_time: "Part time",
  casual: "Casual",
  temporary: "Temporary",
  permanent: "Permanent",
  contract: "Contract",
}

export function formatEmploymentTypeLabel(value: string | null | undefined): string {
  if (!value) return "—"
  const normalized = normalizeEmploymentTypeForSnapshot(value) ?? String(value).trim().toLowerCase()
  if (!normalized) return "—"
  return EMPLOYMENT_TYPE_LABELS[normalized] ?? normalized.replace(/_/g, " ")
}

export function hasGhanaV3IncomeTaxSnapshot(entry: GhanaIncomeTaxEntryFields): boolean {
  const method = entry.income_tax_method ? String(entry.income_tax_method).trim() : ""
  return method.length > 0
}

export function formatGhanaIncomeTaxMethodLabel(method: string | null | undefined): string {
  const key = String(method || "").trim() as GhanaIncomeTaxMethod
  return GHANA_INCOME_TAX_METHOD_LABELS[key] ?? key.replace(/_/g, " ")
}

/** Resident graduated is the only method that should surface "graduated" PAYE wording. */
export function shouldShowGraduatedPayeLabel(method: string | null | undefined): boolean {
  return String(method || "").trim() === "gh_resident_graduated"
}

export function formatPayrollMoney(amount: number, currencySymbol = "₵"): string {
  return `${currencySymbol}${Number(amount).toFixed(2)}`
}

export type EmployeePayeSubBreakdownLine = {
  label: string
  detail: string
}

/** Employee-safe PAYE sub-lines (no method codes or internal classifications). */
export function buildEmployeePayeSubBreakdown(
  entry: GhanaIncomeTaxEntryFields,
  currencySymbol = "₵"
): EmployeePayeSubBreakdownLine[] {
  const fmt = (n: number) => formatPayrollMoney(n, currencySymbol)
  const method = entry.income_tax_method ? String(entry.income_tax_method).trim() : ""

  if (method && hasGhanaV3IncomeTaxSnapshot(entry)) {
    const bonusAmt = Number(entry.income_tax_bonus_amount ?? 0)
    const otAmt = Number(entry.income_tax_overtime_amount ?? 0)

    if (method === "gh_casual_flat_5") {
      const lines: EmployeePayeSubBreakdownLine[] = []
      if (bonusAmt > 0) {
        lines.push({ label: "Bonus tax", detail: `${fmt(bonusAmt)} @ 5%` })
      }
      if (otAmt > 0) {
        lines.push({ label: "Overtime tax", detail: `${fmt(otAmt)} @ 5%` })
      }
      return lines
    }

    if (method === "gh_nonresident_split_25_20") {
      const lines: EmployeePayeSubBreakdownLine[] = []
      if (bonusAmt > 0) {
        lines.push({ label: "Bonus tax", detail: `${fmt(bonusAmt)} @ 20%` })
      }
      if (otAmt > 0) {
        lines.push({ label: "Overtime tax", detail: `${fmt(otAmt)} @ 20%` })
      }
      return lines
    }

    if (method === "gh_resident_graduated") {
      const bonusTax5 = Number(entry.bonus_tax_5 ?? 0)
      const bonusTaxGraduated = Number(entry.bonus_tax_graduated ?? 0)
      const overtimeTax5 = Number(entry.overtime_tax_5 ?? 0)
      const overtimeTax10 = Number(entry.overtime_tax_10 ?? 0)
      const overtimeTaxGraduated = Number(entry.overtime_tax_graduated ?? 0)
      const lines: EmployeePayeSubBreakdownLine[] = []

      if (bonusTax5 > 0 || bonusTaxGraduated > 0) {
        const parts = [`${fmt(bonusTax5)} @ 5%`]
        if (bonusTaxGraduated > 0) parts.push(`${fmt(bonusTaxGraduated)} graduated`)
        lines.push({
          label: "Bonus tax",
          detail: `${fmt(bonusTax5 + bonusTaxGraduated)} (${parts.join(", ")})`,
        })
      }

      if (overtimeTax5 > 0 || overtimeTax10 > 0 || overtimeTaxGraduated > 0) {
        const parts = [`${fmt(overtimeTax5)} @ 5%`, `${fmt(overtimeTax10)} @ 10%`]
        if (overtimeTaxGraduated > 0) parts.push(`${fmt(overtimeTaxGraduated)} graduated`)
        lines.push({
          label: "Overtime tax",
          detail: `${fmt(overtimeTax5 + overtimeTax10 + overtimeTaxGraduated)} (${parts.join(", ")})`,
        })
      }

      return lines
    }

    return []
  }

  const bonusTax5 = Number(entry.bonus_tax_5 ?? 0)
  const bonusTaxGraduated = Number(entry.bonus_tax_graduated ?? 0)
  const overtimeTax5 = Number(entry.overtime_tax_5 ?? 0)
  const overtimeTax10 = Number(entry.overtime_tax_10 ?? 0)
  const overtimeTaxGraduated = Number(entry.overtime_tax_graduated ?? 0)
  const lines: EmployeePayeSubBreakdownLine[] = []

  if (bonusTax5 > 0 || bonusTaxGraduated > 0) {
    const parts = [`${fmt(bonusTax5)} @ 5%`]
    if (bonusTaxGraduated > 0) parts.push(`${fmt(bonusTaxGraduated)} graduated`)
    lines.push({
      label: "Bonus tax",
      detail: `${fmt(bonusTax5 + bonusTaxGraduated)} (${parts.join(", ")})`,
    })
  }

  if (overtimeTax5 > 0 || overtimeTax10 > 0 || overtimeTaxGraduated > 0) {
    const parts = [`${fmt(overtimeTax5)} @ 5%`, `${fmt(overtimeTax10)} @ 10%`]
    if (overtimeTaxGraduated > 0) parts.push(`${fmt(overtimeTaxGraduated)} graduated`)
    lines.push({
      label: "Overtime tax",
      detail: `${fmt(overtimeTax5 + overtimeTax10 + overtimeTaxGraduated)} (${parts.join(", ")})`,
    })
  }

  return lines
}
