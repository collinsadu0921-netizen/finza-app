/**
 * Presentation only. Remaining balance comes from operationalRemainingBalance.
 * This module does not write invoices.status or paid_at.
 */

import { operationalRemainingBalance } from "@/lib/invoices/operationalReceivables"

/** Same 0.01 tolerance the invoice view already uses for a settled balance. */
export const SETTLEMENT_AMOUNT_TOLERANCE = 0.01

export type SettlementLabel =
  | "Amounts unavailable"
  | "Outstanding"
  | "Partially cash paid"
  | "Partially credited"
  | "Mixed cash and credit"
  | "Paid in full"
  | "Fully credited"

export type InvoiceSettlementInput = {
  total: number
  /** Null when the figure was not loaded. Zero is a real zero. */
  payments: number | null
  appliedCredits: number | null
  amountsUnavailable?: boolean
}

export type InvoiceSettlementPresentation = {
  label: SettlementLabel
  remaining: number | null
  cash: number | null
  appliedCredits: number | null
  amountsAvailable: boolean
}

export function sumRecordedPaymentAmounts(amounts: Array<number | null | undefined>): number {
  let total = 0
  for (const amount of amounts) {
    const value = Number(amount)
    if (Number.isFinite(value)) total += value
  }
  return Math.round(total * 100) / 100
}

function approximatelyZero(amount: number): boolean {
  return Math.abs(amount) <= SETTLEMENT_AMOUNT_TOLERANCE
}

function unavailable(): InvoiceSettlementPresentation {
  return {
    label: "Amounts unavailable",
    remaining: null,
    cash: null,
    appliedCredits: null,
    amountsAvailable: false,
  }
}

export function presentInvoiceSettlement(input: InvoiceSettlementInput): InvoiceSettlementPresentation {
  if (input.amountsUnavailable || input.payments == null || input.appliedCredits == null) {
    return unavailable()
  }

  const cash = Number(input.payments)
  const appliedCredits = Number(input.appliedCredits)
  if (!Number.isFinite(cash) || !Number.isFinite(appliedCredits) || !Number.isFinite(Number(input.total))) {
    return unavailable()
  }

  const remaining = operationalRemainingBalance({
    total: Number(input.total) || 0,
    payments: cash,
    appliedCredits,
  })
  const cashZero = approximatelyZero(cash)
  const creditZero = approximatelyZero(appliedCredits)
  const settled = remaining <= SETTLEMENT_AMOUNT_TOLERANCE

  let label: SettlementLabel
  if (!cashZero && !creditZero) {
    label = "Mixed cash and credit"
  } else if (settled && !cashZero && creditZero) {
    label = "Paid in full"
  } else if (settled && cashZero && !creditZero) {
    label = "Fully credited"
  } else if (!settled && !cashZero && creditZero) {
    label = "Partially cash paid"
  } else if (!settled && cashZero && !creditZero) {
    label = "Partially credited"
  } else {
    label = "Outstanding"
  }

  return {
    label,
    remaining,
    cash,
    appliedCredits,
    amountsAvailable: true,
  }
}

const WORKFLOW_BADGE_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  overdue: "Overdue",
  cancelled: "Cancelled",
  void: "Cancelled",
}

/**
 * List badge text. Draft, sent, overdue, and cancelled keep their workflow words.
 * Paid and partially paid are cash claims, so they use the settlement label.
 */
export function listInvoiceBadgeLabel(input: {
  workflowBadgeKey: string
  total: number
  payments: number | null
  appliedCredits: number | null
  amountsUnavailable?: boolean
}): string {
  const workflow = String(input.workflowBadgeKey || "").toLowerCase()
  const workflowLabel = WORKFLOW_BADGE_LABELS[workflow]
  if (workflowLabel) return workflowLabel

  return presentInvoiceSettlement({
    total: input.total,
    payments: input.payments,
    appliedCredits: input.appliedCredits,
    amountsUnavailable: input.amountsUnavailable,
  }).label
}

const CASH_CLAIM_STATUSES = new Set(["paid", "partially_paid", "partial"])

/**
 * Detail status pill. Returns null when the stored workflow word should stay.
 */
export function settlementLabelForCashClaimStatus(
  workflowStatus: string | null | undefined,
  input: InvoiceSettlementInput
): string | null {
  const status = String(workflowStatus || "").trim().toLowerCase()
  if (!CASH_CLAIM_STATUSES.has(status)) return null
  return presentInvoiceSettlement(input).label
}
