/**
 * Customer-facing invoice payment copy (UI / PDF / email).
 * Display only — does not change payment or status calculations in the database.
 */

/** Label for the status pill / PDF line (sentence case). */
export function invoiceCustomerStatusLabel(invoiceStatus: string | null | undefined): string {
  const s = String(invoiceStatus || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
  if (s === "paid") return "Paid"
  if (s === "partially_paid") return "Partially paid"
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
