/**
 * Display labels for Service dashboard recent-activity items.
 * Pure helpers so classification/link wording can be unit-tested.
 */

export type ServiceActivityType =
  | "invoice"
  | "expense"
  | "payment"
  | "customer"
  | "email"
  | "bill"
  | "bill_payment"

export type ServiceActivityItemLike = {
  type: ServiceActivityType
  description?: string | null
}

const INVOICE_NUMBER_RE = /\b(INV-[\w-]+)\b/i
const BILL_NUMBER_RE = /\b(Bill\s*#\s*[\w-]+)\b/i

/** Display-only copy; does not change API payloads. */
export function formatServiceActivityDescription(item: ServiceActivityItemLike): string {
  const raw = item.description?.trim() || ""
  const invNum = raw.match(INVOICE_NUMBER_RE)?.[1]
  const billRef = raw.match(BILL_NUMBER_RE)?.[1]

  switch (item.type) {
    case "payment": {
      if (invNum) return `Payment received — Invoice ${invNum}`
      if (/^payment received/i.test(raw)) return raw
      if (/^payment/i.test(raw)) return raw.replace(/^payment/i, "Payment received")
      return raw ? `Payment received — ${raw}` : "Payment received"
    }
    case "invoice": {
      if (invNum) return `Invoice created — ${invNum}`
      if (/^invoice created/i.test(raw)) return raw
      return raw ? `Invoice created — ${raw}` : "Invoice activity"
    }
    case "expense": {
      if (/^expense recorded/i.test(raw)) return raw
      if (/^expense/i.test(raw)) return raw.replace(/^expense/i, "Expense recorded")
      return raw ? `Expense recorded — ${raw}` : "Expense recorded"
    }
    case "bill": {
      if (/^supplier bill recorded/i.test(raw)) return raw
      if (billRef) return `Supplier bill recorded — ${billRef}`
      if (/^bill\s*#/i.test(raw) || /^import bill\s*#/i.test(raw)) {
        return `Supplier bill recorded — ${raw}`
      }
      return raw ? `Supplier bill recorded — ${raw}` : "Supplier bill recorded"
    }
    case "bill_payment": {
      if (/^supplier bill payment recorded/i.test(raw)) return raw
      if (billRef) return `Supplier bill payment recorded — ${billRef}`
      if (/^payment for bill\s*#/i.test(raw)) {
        return `Supplier bill payment recorded — ${raw.replace(/^payment for\s+/i, "")}`
      }
      return raw ? `Supplier bill payment recorded — ${raw}` : "Supplier bill payment recorded"
    }
    case "customer": {
      if (/^new customer/i.test(raw)) return raw
      return raw ? `New customer — ${raw}` : "New customer added"
    }
    case "email":
      return raw || "Email update"
    default:
      return raw || "Activity"
  }
}

/** Canonical supplier-bill detail route used across Service workspace. */
export function supplierBillDetailHref(billId: string): string {
  return `/bills/${billId}/view`
}

export function expenseDetailHref(expenseId: string): string {
  return `/service/expenses/${expenseId}/view`
}
