export type SalaryAdvanceStatus =
  | "outstanding"
  | "partially_repaid"
  | "cleared"
  | "cancelled"

export type SalaryAdvanceRepaymentStatus = "pending" | "posted" | "voided"

export function computeOutstandingAmount(advanceAmount: number, repaidAmount: number): number {
  const cappedRepaid = Math.min(Math.max(0, repaidAmount), Math.max(0, advanceAmount))
  return Math.max(0, advanceAmount - cappedRepaid)
}

export function validateRepaymentAmount(amount: number, outstandingAmount: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) {
    return "amount must be a positive number"
  }
  if (amount > outstandingAmount) {
    return "Repayment exceeds outstanding balance"
  }
  return null
}

export function normalizeAdvanceStatus(
  status: string | null | undefined,
  advanceAmount: number,
  repaidAmount: number,
  cancelledAt?: string | null
): SalaryAdvanceStatus {
  if (cancelledAt) return "cancelled"
  if (status && ["outstanding", "partially_repaid", "cleared", "cancelled"].includes(status)) {
    return status as SalaryAdvanceStatus
  }
  const outstanding = computeOutstandingAmount(advanceAmount, repaidAmount)
  if (outstanding <= 0) return "cleared"
  if (repaidAmount > 0) return "partially_repaid"
  return "outstanding"
}

export function applyRepaymentToAdvance(input: {
  amount: number
  repaid_amount: number
  cancelled_at?: string | null
  cleared_at?: string | null
  repaymentAmount: number
}): {
  repaid_amount: number
  status: SalaryAdvanceStatus
  cleared_at: string | null
} {
  const newRepaid = Math.min(input.amount, input.repaid_amount + input.repaymentAmount)
  const status = normalizeAdvanceStatus(null, input.amount, newRepaid, input.cancelled_at)
  const cleared_at =
    status === "cleared" && !input.cancelled_at
      ? input.cleared_at ?? new Date().toISOString()
      : null

  return { repaid_amount: newRepaid, status, cleared_at }
}
