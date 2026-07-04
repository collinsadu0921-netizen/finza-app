export type PayrollEntryTotalsRow = {
  is_included?: boolean | null
  gross_salary?: number | null
  allowances_total?: number | null
  deductions_total?: number | null
  ssnit_employee?: number | null
  ssnit_employer?: number | null
  paye?: number | null
  net_salary?: number | null
}

export type PayrollRunTotals = {
  total_gross_salary: number
  total_allowances: number
  total_deductions: number
  total_ssnit_employee: number
  total_ssnit_employer: number
  total_paye: number
  total_net_salary: number
}

const safe = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** Sum payroll entry amounts for included lines only. */
export function rollupPayrollRunTotals(entries: PayrollEntryTotalsRow[]): PayrollRunTotals {
  return entries
    .filter((entry) => entry.is_included !== false)
    .reduce(
      (acc, entry) => {
        acc.total_gross_salary += safe(entry.gross_salary)
        acc.total_allowances += safe(entry.allowances_total)
        acc.total_deductions += safe(entry.deductions_total)
        acc.total_ssnit_employee += safe(entry.ssnit_employee)
        acc.total_ssnit_employer += safe(entry.ssnit_employer)
        acc.total_paye += safe(entry.paye)
        acc.total_net_salary += safe(entry.net_salary)
        return acc
      },
      {
        total_gross_salary: 0,
        total_allowances: 0,
        total_deductions: 0,
        total_ssnit_employee: 0,
        total_ssnit_employer: 0,
        total_paye: 0,
        total_net_salary: 0,
      }
    )
}
