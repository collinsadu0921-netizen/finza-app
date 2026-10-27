/**
 * Display helpers for VAT ledger lines.
 *
 * Ledger rows carry machine reference types and UUIDs. Accountants need the
 * human document number (invoice/bill/credit note) instead of a raw UUID.
 */

export type LedgerDisplayLine = {
  reference_type?: string | null
  reference_id?: string | null
  /** Human label resolved by the API, e.g. "Invoice INV-00042". */
  reference_label?: string | null
  source_type?: string | null
}

const TYPE_LABELS: Record<string, string> = {
  invoice: "Invoice",
  bill: "Bill",
  bill_payment: "Bill payment",
  credit_note: "Credit note",
  expense: "Expense",
  payment: "Payment",
  payroll: "Payroll",
  payroll_obligation_payment: "Payroll obligation payment",
  depreciation: "Depreciation",
  asset: "Asset",
  asset_disposal: "Asset disposal",
  service_job_usage: "Service job usage",
  reversal: "Reversal",
  manual_journal: "Manual journal",
  vat_return_payment: "VAT return payment",
  test_vat_accrual: "VAT accrual",
}

export function humanizeLedgerType(value: string | null | undefined): string {
  const raw = value?.trim()
  if (!raw) return "—"
  const key = raw.toLowerCase()
  if (TYPE_LABELS[key]) return TYPE_LABELS[key]
  const words = raw.replace(/[_-]+/g, " ").trim()
  if (!words) return "—"
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The source/type column label: "Invoice", "Bill", "Expense", ... */
export function ledgerSourceLabel(line: LedgerDisplayLine): string {
  if (line.reference_type) return humanizeLedgerType(line.reference_type)
  if (line.source_type) return humanizeLedgerType(line.source_type)
  return "—"
}

/** Short, copy-safe fallback when no document number was resolved. */
export function shortReferenceId(id: string | null | undefined): string {
  const value = id?.trim()
  if (!value) return "—"
  return value.length > 12 ? value.slice(0, 8) : value
}

/**
 * The reference column label. Prefers the resolved document number from the
 * API, then falls back to a short id (never a full raw UUID).
 */
export function ledgerReferenceLabel(line: LedgerDisplayLine): string {
  const label = line.reference_label?.trim()
  if (label) return label
  if (line.reference_id) return `#${shortReferenceId(line.reference_id)}`
  return "—"
}
