/**
 * Staff payout methods (staff_payment_methods) — validation helpers and CSV payout resolution.
 * No payment integrations.
 */

export const STAFF_PAYMENT_METHOD_TYPES = ["bank", "momo", "cash"] as const
export type StaffPaymentMethodType = (typeof STAFF_PAYMENT_METHOD_TYPES)[number]

export function normalizeMethodType(raw: unknown): StaffPaymentMethodType | null {
  const s = String(raw ?? "").trim().toLowerCase()
  return (STAFF_PAYMENT_METHOD_TYPES as readonly string[]).includes(s)
    ? (s as StaffPaymentMethodType)
    : null
}

export type StaffPaymentMethodWriteBody = {
  method_type: unknown
  provider_name?: unknown
  bank_name?: unknown
  bank_code?: unknown
  branch_name?: unknown
  account_number?: unknown
  account_name?: unknown
  momo_provider?: unknown
  momo_number?: unknown
  is_default?: unknown
}

export function validateStaffPaymentMethodCreate(
  body: StaffPaymentMethodWriteBody
): { ok: true; method_type: StaffPaymentMethodType } | { ok: false; error: string } {
  const method_type = normalizeMethodType(body.method_type)
  if (!method_type) {
    return { ok: false, error: "Invalid method_type. Use bank, momo, or cash." }
  }

  const bankName = trimOrEmpty(body.bank_name)
  const accountNumber = trimOrEmpty(body.account_number)
  const momoProvider = trimOrEmpty(body.momo_provider)
  const momoNumber = trimOrEmpty(body.momo_number)

  if (method_type === "bank") {
    if (!bankName) return { ok: false, error: "Bank name is required for bank payment methods." }
    if (!accountNumber) {
      return { ok: false, error: "Account number is required for bank payment methods." }
    }
  }
  if (method_type === "momo") {
    if (!momoProvider) {
      return { ok: false, error: "Mobile money provider is required for MoMo payment methods." }
    }
    if (!momoNumber) {
      return { ok: false, error: "Mobile money number is required for MoMo payment methods." }
    }
  }

  return { ok: true, method_type }
}

export function validateStaffPaymentMethodPatch(
  existingType: StaffPaymentMethodType,
  patch: Partial<StaffPaymentMethodWriteBody>
): { ok: true; nextType: StaffPaymentMethodType } | { ok: false; error: string } {
  const nextTypeRaw = patch.method_type !== undefined ? normalizeMethodType(patch.method_type) : null
  if (patch.method_type !== undefined && !nextTypeRaw) {
    return { ok: false, error: "Invalid method_type." }
  }
  const nextType = nextTypeRaw ?? existingType

  const bank_name = patch.bank_name !== undefined ? trimOrEmpty(patch.bank_name) : undefined
  const account_number =
    patch.account_number !== undefined ? trimOrEmpty(patch.account_number) : undefined
  const momo_provider =
    patch.momo_provider !== undefined ? trimOrEmpty(patch.momo_provider) : undefined
  const momo_number = patch.momo_number !== undefined ? trimOrEmpty(patch.momo_number) : undefined

  if (nextType === "bank") {
    const bn = bank_name !== undefined ? bank_name : null
    const an = account_number !== undefined ? account_number : null
    if (bn === "" || an === "") {
      return { ok: false, error: "Bank name and account number cannot be empty for bank methods." }
    }
  }
  if (nextType === "momo") {
    const mp = momo_provider !== undefined ? momo_provider : null
    const mn = momo_number !== undefined ? momo_number : null
    if (mp === "" || mn === "") {
      return { ok: false, error: "MoMo provider and number cannot be empty for MoMo methods." }
    }
  }

  return { ok: true, nextType }
}

export type StaffLegacyBankFields = {
  bank_name?: string | null
  bank_account?: string | null
  phone?: string | null
}

export type StaffDefaultPaymentMethodRow = {
  method_type: string
  bank_name?: string | null
  account_number?: string | null
  account_name?: string | null
  momo_provider?: string | null
  momo_number?: string | null
} | null

/**
 * Prefer default staff_payment_methods row when present for net-salary CSV columns.
 * Falls back to legacy staff.bank_* (and phone for MoMo) when no usable method details.
 */
export function resolveNetSalaryExportPayoutFields(
  staff: StaffLegacyBankFields,
  defaultMethod: StaffDefaultPaymentMethodRow
): {
  bankName: string
  bankAccountNumber: string
  accountName: string
  momoProvider: string
  momoNumber: string
} {
  const legacyBank = String(staff.bank_name ?? "").trim()
  const legacyAcct = String(staff.bank_account ?? "").trim()
  const legacyPhone = String(staff.phone ?? "").trim()

  if (!defaultMethod) {
    return {
      bankName: legacyBank,
      bankAccountNumber: legacyAcct,
      accountName: "",
      momoProvider: "",
      momoNumber: legacyPhone,
    }
  }

  const mt = String(defaultMethod.method_type || "").toLowerCase()

  if (mt === "bank") {
    const bn = String(defaultMethod.bank_name ?? "").trim()
    const acct = String(defaultMethod.account_number ?? "").trim()
    const an = String(defaultMethod.account_name ?? "").trim()
    return {
      bankName: bn || legacyBank,
      bankAccountNumber: acct || legacyAcct,
      accountName: an,
      momoProvider: "",
      momoNumber: "",
    }
  }

  if (mt === "momo") {
    const prov = String(defaultMethod.momo_provider ?? "").trim()
    const num = String(defaultMethod.momo_number ?? "").trim()
    const an = String(defaultMethod.account_name ?? "").trim()
    return {
      bankName: "",
      bankAccountNumber: "",
      accountName: an,
      momoProvider: prov,
      momoNumber: num || legacyPhone,
    }
  }

  // cash: no structured payout on method — preserve legacy bank columns as today
  return {
    bankName: legacyBank,
    bankAccountNumber: legacyAcct,
    accountName: "",
    momoProvider: "",
    momoNumber: legacyPhone,
  }
}

function trimOrEmpty(v: unknown): string {
  if (v == null) return ""
  return String(v).trim()
}
