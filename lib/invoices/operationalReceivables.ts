/**
 * Canonical operational receivables rules shared by the dashboard unpaid RPC
 * and the invoice overdue list. Remaining balance is invoice total minus
 * recorded payments minus applied credit notes. Ledger customer balances are
 * a different metric and are not computed here.
 */

export type OperationalInvoiceStatusInput = {
  status: string | null | undefined
  deleted?: boolean
  dueDate?: string | null
  total: number
  payments: number
  appliedCredits: number
}

export function operationalRemainingBalance(input: {
  total: number
  payments: number
  appliedCredits: number
}): number {
  const remaining =
    (Number(input.total) || 0) - (Number(input.payments) || 0) - (Number(input.appliedCredits) || 0)
  return Math.round(Math.max(0, remaining) * 100) / 100
}

const EXCLUDED_OPERATIONAL_STATUSES = new Set(["draft", "cancelled"])

export function isOperationallyUnpaid(input: OperationalInvoiceStatusInput): boolean {
  if (input.deleted) return false
  const status = (input.status || "").toLowerCase()
  if (EXCLUDED_OPERATIONAL_STATUSES.has(status)) return false
  return operationalRemainingBalance(input) > 0
}

export function isOperationallyOverdue(
  input: OperationalInvoiceStatusInput,
  today: string
): boolean {
  if (!isOperationallyUnpaid(input)) return false
  if (!input.dueDate) return false
  const due = String(input.dueDate).split("T")[0]
  return due < today
}

export function sumOperationalUnpaid(rows: OperationalInvoiceStatusInput[]): number {
  const total = rows.reduce(
    (sum, row) => sum + (isOperationallyUnpaid(row) ? operationalRemainingBalance(row) : 0),
    0
  )
  return Math.round(total * 100) / 100
}
