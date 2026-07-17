export type PayrollRunLabelInput = {
  payroll_month?: string | null
  pay_period_start?: string | null
  pay_period_end?: string | null
  payroll_frequency?: string | null
  run_type?: string | null
}

const RUN_TYPE_LABELS: Record<string, string> = {
  regular: "Salary",
  bonus: "Bonus",
  correction: "Correction",
  job_based: "Job-based",
  advance_adjustment: "Advance adjustment",
}

function formatShortDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** Tenant-facing payroll run label (month name or explicit date range + type). */
export function formatPayrollRunLabel(run: PayrollRunLabelInput): string {
  const frequency = String(run.payroll_frequency || "monthly").toLowerCase()
  const runType = String(run.run_type || "regular").toLowerCase()
  const typeLabel = RUN_TYPE_LABELS[runType] || runType
  const start = String(run.pay_period_start || run.payroll_month || "").slice(0, 10)
  const end = String(run.pay_period_end || start).slice(0, 10)

  if (!start) return typeLabel

  if (frequency === "monthly" && runType === "regular") {
    return new Date(`${start}T00:00:00.000Z`).toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    })
  }

  const range =
    start === end ? formatShortDate(start) : `${formatShortDate(start)} – ${formatShortDate(end)}`

  if (runType === "regular") {
    return range
  }

  return `${typeLabel} · ${range}`
}

export function duplicatePayrollRunErrorMessage(run: PayrollRunLabelInput): string {
  const label = formatPayrollRunLabel(run)
  const runType = String(run.run_type || "regular")
  if (runType !== "regular") {
    return `A ${RUN_TYPE_LABELS[runType]?.toLowerCase() || runType} payroll run already exists for ${label} with the same employee scope.`
  }
  return `A payroll run already exists for ${label} with the same employee scope.`
}

export function formatPayrollRunTypeBadge(runType: string | null | undefined): string {
  const key = String(runType || "regular").toLowerCase()
  return RUN_TYPE_LABELS[key] || key
}
