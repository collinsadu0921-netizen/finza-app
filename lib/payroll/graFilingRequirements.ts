/**
 * GRA DT 107A filing requirements.
 *
 * These details are required when preparing a GRA return. They are not
 * required to calculate, approve or pay payroll.
 */

export type GraFilingEntryRow = {
  staff_id?: string | null
  filing_employee_name?: string | null
  filing_tin?: string | null
  payroll_tax_profile?: Record<string, unknown> | null
  is_included?: boolean | null
  staff?: { name?: string | null } | Array<{ name?: string | null }> | null
}

export type MissingGraFilingDetail = {
  staffId: string
  employeeName: string
}

export function findMissingGraFilingDetails(
  rows: GraFilingEntryRow[]
): MissingGraFilingDetail[] {
  return (rows || [])
    .filter((row) => row.is_included !== false)
    .filter((row) => {
      const profile =
        row.payroll_tax_profile && typeof row.payroll_tax_profile === "object"
          ? row.payroll_tax_profile
          : {}
      const tin = String(row.filing_tin ?? "").trim()
      const position = String(profile.gra_position_code ?? "").trim()
      return !tin || !position
    })
    .map((row) => {
      const staff = Array.isArray(row.staff) ? row.staff[0] : row.staff
      return {
        staffId: String(row.staff_id ?? ""),
        employeeName: String(
          row.filing_employee_name || staff?.name || "Employee"
        ),
      }
    })
}
