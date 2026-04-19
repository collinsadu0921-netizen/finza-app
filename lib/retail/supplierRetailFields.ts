/** Retail supplier profile — Ghana-oriented, kept simple (not enterprise procurement). */

export const SUPPLIER_PAYMENT_PREFERENCES = [
  "cash",
  "mobile_money",
  "bank_transfer",
  "credit",
] as const

export type SupplierPaymentPreference = (typeof SUPPLIER_PAYMENT_PREFERENCES)[number]

export const SUPPLIER_PAYMENT_TERMS_TYPES = [
  "on_delivery",
  "net_7",
  "net_14",
  "net_30",
  "custom",
] as const

export type SupplierPaymentTermsType = (typeof SUPPLIER_PAYMENT_TERMS_TYPES)[number]

export function isSupplierPaymentPreference(v: unknown): v is SupplierPaymentPreference {
  return typeof v === "string" && (SUPPLIER_PAYMENT_PREFERENCES as readonly string[]).includes(v)
}

export function isSupplierPaymentTermsType(v: unknown): v is SupplierPaymentTermsType {
  return typeof v === "string" && (SUPPLIER_PAYMENT_TERMS_TYPES as readonly string[]).includes(v)
}

export function supplierPaymentPreferenceLabel(v: string | null | undefined): string {
  if (!v) return "—"
  const map: Record<string, string> = {
    cash: "Cash",
    mobile_money: "Mobile money",
    bank_transfer: "Bank transfer",
    credit: "Credit",
  }
  return map[v] ?? v
}

export function supplierPaymentTermsLabel(v: string | null | undefined, custom?: string | null): string {
  if (!v) return "—"
  const map: Record<string, string> = {
    on_delivery: "On delivery",
    net_7: "7 days",
    net_14: "14 days",
    net_30: "30 days",
    custom: custom?.trim() ? custom.trim() : "Custom",
  }
  return map[v] ?? v
}

/** Suggested MoMo networks for UI hints only (free text stored). */
export const SUPPLIER_MOMO_NETWORK_HINTS = ["MTN", "Vodafone", "AirtelTigo"] as const
