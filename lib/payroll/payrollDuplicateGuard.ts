import {
  duplicatePayrollRunErrorMessage,
  type PayrollRunLabelInput,
} from "@/lib/payroll/payrollRunLabels"
import {
  findDuplicatePayrollRun,
  type PayrollDuplicateCandidate,
} from "@/lib/payroll/payrollPeriodUtils"

export type ExistingPayrollRunRow = PayrollDuplicateCandidate & {
  id: string
}

export function assertNoDuplicatePayrollRun(
  candidate: PayrollDuplicateCandidate,
  existingRuns: ExistingPayrollRunRow[]
): void {
  const duplicate = findDuplicatePayrollRun(candidate, existingRuns)
  if (!duplicate) return

  const labelInput: PayrollRunLabelInput = {
    pay_period_start: candidate.pay_period_start,
    pay_period_end: candidate.pay_period_end,
    payroll_frequency: candidate.payroll_frequency,
    run_type: candidate.run_type,
    payroll_month: candidate.pay_period_start,
  }

  throw new DuplicatePayrollRunError(duplicatePayrollRunErrorMessage(labelInput), duplicate.id)
}

export class DuplicatePayrollRunError extends Error {
  readonly existingRunId: string

  constructor(message: string, existingRunId: string) {
    super(message)
    this.name = "DuplicatePayrollRunError"
    this.existingRunId = existingRunId
  }
}
