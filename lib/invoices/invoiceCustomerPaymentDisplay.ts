/**
 * Customer-facing invoice payment copy (UI / PDF / email).
 * Display only — does not change payment or status calculations in the database.
 */

import {
  presentInvoiceSettlement,
  type InvoiceSettlementInput,
} from "@/lib/invoices/invoiceSettlementPresentation"

/** Label for the status pill / PDF line (sentence case). */
export function invoiceCustomerStatusLabel(
  invoiceStatus: string | null | undefined,
  settlement?: InvoiceSettlementInput | null
): string {
  const s = String(invoiceStatus || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
  if (s === "paid" || s === "partially_paid" || s === "partial") {
    if (!settlement) return "Amounts unavailable"
    return presentInvoiceSettlement(settlement).label
  }
  if (s === "overdue") return "Overdue"
  if (
    s === "sent" ||
    s === "awaiting_payment" ||
    s === "payment_pending" ||
    s === "draft" ||
    s === "unsent"
  ) {
    return "Payment pending"
  }
  return s
    ? s
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
    : "Payment pending"
}
