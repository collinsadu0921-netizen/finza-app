export const PAYROLL_FREQUENCIES = [
  "monthly",
  "weekly",
  "fortnightly",
  "daily",
  "casual",
  "custom",
] as const

export type PayrollFrequency = (typeof PAYROLL_FREQUENCIES)[number]

export const PAYROLL_RUN_TYPES = [
  "regular",
  "bonus",
  "correction",
  "job_based",
  "advance_adjustment",
] as const

export type PayrollRunType = (typeof PAYROLL_RUN_TYPES)[number]

export type PayrollRunPeriodFields = {
  payroll_month: string
  pay_period_start: string
  pay_period_end: string
  payroll_frequency: PayrollFrequency
  run_type: PayrollRunType
  corrects_payroll_run_id?: string | null
}

export type CreatePayrollRunPeriodInput = {
  payroll_month?: string | null
  pay_period_start?: string | null
  pay_period_end?: string | null
  payroll_frequency?: string | null
  run_type?: string | null
  corrects_payroll_run_id?: string | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function parseIsoDate(value: string, field: string): Date {
  if (!ISO_DATE.test(value)) {
    throw new Error(`${field} must be YYYY-MM-DD`)
  }
  const d = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`${field} is not a valid date`)
  }
  return d
}

function formatIsoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function monthBoundsFromAnchor(anchor: string): { start: string; end: string } {
  const d = parseIsoDate(anchor.slice(0, 10), "payroll_month")
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
  return { start: formatIsoDateUtc(start), end: formatIsoDateUtc(end) }
}

export function defaultWeeklyEnd(startIso: string): string {
  const start = parseIsoDate(startIso, "pay_period_start")
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  return formatIsoDateUtc(end)
}

export function defaultFortnightlyEnd(startIso: string): string {
  const start = parseIsoDate(startIso, "pay_period_start")
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 13)
  return formatIsoDateUtc(end)
}

function assertFrequency(value: string | null | undefined): PayrollFrequency {
  const normalized = String(value || "monthly").toLowerCase()
  if (!(PAYROLL_FREQUENCIES as readonly string[]).includes(normalized)) {
    throw new Error(`Invalid payroll_frequency: ${value}`)
  }
  return normalized as PayrollFrequency
}

function assertRunType(value: string | null | undefined): PayrollRunType {
  const normalized = String(value || "regular").toLowerCase()
  if (!(PAYROLL_RUN_TYPES as readonly string[]).includes(normalized)) {
    throw new Error(`Invalid run_type: ${value}`)
  }
  return normalized as PayrollRunType
}

/** Resolve create payload into normalized period fields (backward compatible with payroll_month). */
export function resolveCreatePayrollRunPeriod(
  input: CreatePayrollRunPeriodInput
): PayrollRunPeriodFields {
  const payroll_frequency = assertFrequency(input.payroll_frequency)
  const run_type = assertRunType(input.run_type)

  let pay_period_start = input.pay_period_start?.slice(0, 10) || null
  let pay_period_end = input.pay_period_end?.slice(0, 10) || null
  const payroll_month = input.payroll_month?.slice(0, 10) || null

  if (!pay_period_start && payroll_month) {
    if (payroll_frequency === "monthly") {
      const bounds = monthBoundsFromAnchor(payroll_month)
      pay_period_start = bounds.start
      pay_period_end = bounds.end
    } else {
      pay_period_start = payroll_month
    }
  }

  if (!pay_period_start) {
    throw new Error("pay_period_start or payroll_month is required")
  }

  parseIsoDate(pay_period_start, "pay_period_start")

  if (!pay_period_end) {
    if (payroll_frequency === "monthly") {
      pay_period_end = monthBoundsFromAnchor(pay_period_start).end
    } else if (payroll_frequency === "weekly") {
      pay_period_end = defaultWeeklyEnd(pay_period_start)
    } else if (payroll_frequency === "fortnightly") {
      pay_period_end = defaultFortnightlyEnd(pay_period_start)
    } else if (payroll_frequency === "daily") {
      pay_period_end = pay_period_start
    } else {
      throw new Error("pay_period_end is required for this payroll frequency")
    }
  }

  parseIsoDate(pay_period_end, "pay_period_end")

  if (pay_period_end < pay_period_start) {
    throw new Error("pay_period_end must be on or after pay_period_start")
  }

  const payroll_month_anchor =
    payroll_frequency === "monthly" ? monthBoundsFromAnchor(pay_period_start).start : pay_period_start

  return {
    payroll_month: payroll_month_anchor,
    pay_period_start,
    pay_period_end,
    payroll_frequency,
    run_type,
    corrects_payroll_run_id: input.corrects_payroll_run_id ?? null,
  }
}

export type PayrollDuplicateCandidate = {
  business_id: string
  payroll_frequency: string
  run_type: string
  pay_period_start: string
  pay_period_end: string
  staff_scope_fingerprint: string
  status?: string | null
  deleted_at?: string | null
}

export function findDuplicatePayrollRun<T extends PayrollDuplicateCandidate>(
  candidate: PayrollDuplicateCandidate,
  existingRuns: T[]
): T | null {
  for (const run of existingRuns) {
    if (run.deleted_at) continue
    if (
      run.business_id === candidate.business_id &&
      String(run.payroll_frequency) === candidate.payroll_frequency &&
      String(run.run_type) === candidate.run_type &&
      String(run.pay_period_start).slice(0, 10) === candidate.pay_period_start &&
      String(run.pay_period_end).slice(0, 10) === candidate.pay_period_end &&
      run.staff_scope_fingerprint === candidate.staff_scope_fingerprint
    ) {
      return run
    }
  }
  return null
}
