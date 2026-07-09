import { formatPayrollRunLabel, type PayrollRunLabelInput } from "@/lib/payroll/payrollRunLabels"

export type PayrollRunExportMeta = PayrollRunLabelInput

export function payrollExportFilename(prefix: string, run: PayrollRunExportMeta): string {
  const start = String(run.pay_period_start || run.payroll_month || "run").slice(0, 10)
  const end = String(run.pay_period_end || start).slice(0, 10)
  const slug = start === end ? start : `${start}_to_${end}`
  return `${prefix}-${slug}.csv`
}

export const PAYROLL_EXPORT_PERIOD_HEADERS = [
  "Pay Period Label",
  "Period Start",
  "Period End",
  "Pay Frequency",
  "Run Type",
] as const

export function payrollExportPeriodValues(run: PayrollRunExportMeta): string[] {
  return [
    formatPayrollRunLabel(run),
    String(run.pay_period_start || run.payroll_month || "").slice(0, 10),
    String(run.pay_period_end || run.pay_period_start || run.payroll_month || "").slice(0, 10),
    String(run.payroll_frequency || "monthly"),
    String(run.run_type || "regular"),
  ]
}

/** Append period metadata columns to a CSV header row and data row. */
export function withPayrollExportPeriodColumns(
  headers: string[],
  values: string[],
  run: PayrollRunExportMeta
): { headers: string[]; values: string[] } {
  return {
    headers: [...headers, ...PAYROLL_EXPORT_PERIOD_HEADERS],
    values: [...values, ...payrollExportPeriodValues(run)],
  }
}

/** Formatted tenant-facing pay period label for export cells. */
export function payrollPeriodCellValue(run: PayrollRunExportMeta): string {
  return formatPayrollRunLabel(run)
}
