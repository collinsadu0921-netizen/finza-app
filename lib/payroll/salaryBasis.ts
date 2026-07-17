export const SALARY_BASES = ["monthly", "weekly", "fortnightly"] as const
export type SalaryBasis = (typeof SALARY_BASES)[number]

/** Phase 1B payroll frequencies that may create runs. */
export const PHASE_1B_PAYROLL_FREQUENCIES = ["monthly", "weekly", "fortnightly"] as const
export type Phase1BPayrollFrequency = (typeof PHASE_1B_PAYROLL_FREQUENCIES)[number]

export function parseSalaryBasis(value: unknown): SalaryBasis {
  const normalized = String(value ?? "monthly").trim().toLowerCase()
  if ((SALARY_BASES as readonly string[]).includes(normalized)) {
    return normalized as SalaryBasis
  }
  throw new Error(`Invalid salary_basis: ${String(value)}. Allowed: ${SALARY_BASES.join(", ")}`)
}

export function isSalaryBasis(value: unknown): value is SalaryBasis {
  return (SALARY_BASES as readonly string[]).includes(String(value ?? "").trim().toLowerCase())
}

export function isPhase1BPayrollFrequency(value: unknown): value is Phase1BPayrollFrequency {
  return (PHASE_1B_PAYROLL_FREQUENCIES as readonly string[]).includes(
    String(value ?? "").trim().toLowerCase()
  )
}

export function assertPhase1BPayrollFrequency(frequency: string): Phase1BPayrollFrequency {
  const normalized = String(frequency || "").trim().toLowerCase()
  if (normalized === "custom" || normalized === "casual") {
    throw new Error("Custom payroll periods are not yet available.")
  }
  if (normalized === "daily") {
    throw new Error("Daily payroll is not available in this phase.")
  }
  if (!isPhase1BPayrollFrequency(normalized)) {
    throw new Error(
      `Unsupported payroll frequency for Phase 1B: ${frequency}. Allowed: ${PHASE_1B_PAYROLL_FREQUENCIES.join(", ")}`
    )
  }
  return normalized
}

export function salaryBasisMatchesFrequency(
  salaryBasis: SalaryBasis | string | null | undefined,
  payrollFrequency: string | null | undefined
): boolean {
  const basis = String(salaryBasis || "monthly").trim().toLowerCase()
  const frequency = String(payrollFrequency || "").trim().toLowerCase()
  return basis === frequency
}

export function exclusionReasonForSalaryBasisMismatch(
  salaryBasis: SalaryBasis | string | null | undefined,
  payrollFrequency: string | null | undefined
): string {
  const basis = String(salaryBasis || "monthly").trim().toLowerCase()
  const frequency = String(payrollFrequency || "payroll").trim().toLowerCase()
  return `Excluded: employee salary basis (${basis}) does not match this ${frequency} payroll run.`
}

/** Ghana PAYE bands in the engine are monthly; do not approve non-monthly GH runs. */
export function isGhanaMonthlyStatutoryEngine(businessCountry: string | null | undefined): boolean {
  const country = String(businessCountry || "").trim().toLowerCase()
  return country === "gh" || country === "ghana"
}

export function nonMonthlyApprovalBlockedMessage(payrollFrequency: string): string {
  return (
    `Cannot approve ${payrollFrequency} payroll: Ghana PAYE/SSNIT calculations currently use monthly statutory bands. ` +
    `Weekly and fortnightly drafts may be reviewed, but approval is blocked until a non-monthly statutory engine is available.`
  )
}
