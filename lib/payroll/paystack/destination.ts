import { createHash } from "crypto"
import type { PaystackRecipientInput } from "./paystackClient"

export type PaystackPayoutDestination =
  | {
      ok: true
      method_type: "bank"
      type: "ghipss"
      provider_code: string
      bank_name: string
      bank_code: string
      account_number: string
      account_name: string
      fingerprint: string
    }
  | {
      ok: true
      method_type: "momo"
      type: "mobile_money"
      provider_code: string
      provider_name: string
      momo_number: string
      account_name: string
      fingerprint: string
    }
  | { ok: false; code: string; message: string }

export type FrozenBatchDestination = {
  destination_method_type?: string | null
  destination_provider_name?: string | null
  destination_bank_name?: string | null
  destination_bank_code?: string | null
  destination_account_number?: string | null
  destination_account_name?: string | null
  destination_momo_provider?: string | null
  destination_momo_number?: string | null
}

const MOMO_PROVIDERS: Record<string, { code: string; label: string }> = {
  mtn: { code: "MTN", label: "MTN Mobile Money" },
  "mtn mobile money": { code: "MTN", label: "MTN Mobile Money" },
  vod: { code: "VOD", label: "Telecel Cash (Vodafone)" },
  vodafone: { code: "VOD", label: "Telecel Cash (Vodafone)" },
  telecel: { code: "VOD", label: "Telecel Cash (Vodafone)" },
  atl: { code: "ATL", label: "AirtelTigo Money" },
  airteltigo: { code: "ATL", label: "AirtelTigo Money" },
  "airtel tigo": { code: "ATL", label: "AirtelTigo Money" },
  tgo: { code: "ATL", label: "AirtelTigo Money" },
}

export function normalizeGhanaMomoProvider(raw: unknown): { code: string; label: string } | null {
  const key = String(raw ?? "").trim().toLowerCase().replace(/[_-]+/g, " ")
  return MOMO_PROVIDERS[key] ?? null
}

/** Ghana local 10-digit form (0XXXXXXXXX); returns null when it cannot be normalized safely. */
export function normalizeGhanaMomoNumber(raw: unknown): string | null {
  let digits = String(raw ?? "").replace(/[^\d+]/g, "")
  if (digits.startsWith("+233")) digits = `0${digits.slice(4)}`
  else if (digits.startsWith("233")) digits = `0${digits.slice(3)}`
  if (!/^0\d{9}$/.test(digits)) return null
  return digits
}

export function normalizeGhanaBankAccountNumber(raw: unknown): string | null {
  const value = String(raw ?? "").replace(/\s+/g, "").trim()
  return /^\d{8,20}$/.test(value) ? value : null
}

export function destinationFingerprint(parts: {
  business_id: string
  staff_id: string
  method_type: string
  bank_code?: string | null
  account_number?: string | null
  momo_provider?: string | null
  momo_number?: string | null
  account_name?: string | null
}): string {
  const canonical = [
    parts.business_id,
    parts.staff_id,
    parts.method_type,
    (parts.bank_code ?? "").toUpperCase(),
    parts.account_number ?? "",
    (parts.momo_provider ?? "").toUpperCase(),
    parts.momo_number ?? "",
    (parts.account_name ?? "").trim().toLowerCase(),
  ].join("|")
  return createHash("sha256").update(canonical, "utf8").digest("hex")
}

export function resolvePaystackDestination(input: {
  businessId: string
  staffId: string
  destination: FrozenBatchDestination
}): PaystackPayoutDestination {
  const method = String(input.destination.destination_method_type ?? "").trim().toLowerCase()

  if (method === "bank") {
    const bankCode = String(input.destination.destination_bank_code ?? "").trim().toUpperCase()
    const bankName = String(input.destination.destination_bank_name ?? "").trim()
    const accountNumber = normalizeGhanaBankAccountNumber(input.destination.destination_account_number)
    const accountName = String(input.destination.destination_account_name ?? "").trim()

    if (!bankCode) {
      return {
        ok: false,
        code: "PAYSTACK_DESTINATION_BANK_CODE_MISSING",
        message: "Select a supported Ghana bank for this employee before using Paystack.",
      }
    }
    if (!bankName) {
      return {
        ok: false,
        code: "PAYSTACK_DESTINATION_BANK_MISSING",
        message: "The employee bank name is missing from this payment batch.",
      }
    }
    if (!accountNumber) {
      return {
        ok: false,
        code: "PAYSTACK_DESTINATION_ACCOUNT_INVALID",
        message: "The employee bank account number is missing or invalid.",
      }
    }
    if (!accountName) {
      return {
        ok: false,
        code: "PAYSTACK_DESTINATION_ACCOUNT_NAME_MISSING",
        message: "The employee account holder name is required for Paystack transfers.",
      }
    }

    return {
      ok: true,
      method_type: "bank",
      type: "ghipss",
      provider_code: bankCode,
      bank_name: bankName,
      bank_code: bankCode,
      account_number: accountNumber,
      account_name: accountName,
      fingerprint: destinationFingerprint({
        business_id: input.businessId,
        staff_id: input.staffId,
        method_type: "bank",
        bank_code: bankCode,
        account_number: accountNumber,
        account_name: accountName,
      }),
    }
  }

  if (method === "momo") {
    const provider = normalizeGhanaMomoProvider(
      input.destination.destination_momo_provider ?? input.destination.destination_provider_name
    )
    const momoNumber = normalizeGhanaMomoNumber(input.destination.destination_momo_number)
    const accountName = String(input.destination.destination_account_name ?? "").trim()

    if (!provider) {
      return {
        ok: false,
        code: "PAYSTACK_DESTINATION_MOMO_PROVIDER_INVALID",
        message: "Select MTN, Telecel or AirtelTigo for this employee's Mobile Money destination.",
      }
    }
    if (!momoNumber) {
      return {
        ok: false,
        code: "PAYSTACK_DESTINATION_MOMO_NUMBER_INVALID",
        message: "The employee Mobile Money number is missing or invalid.",
      }
    }
    if (!accountName) {
      return {
        ok: false,
        code: "PAYSTACK_DESTINATION_ACCOUNT_NAME_MISSING",
        message: "The employee Mobile Money recipient name is required for Paystack transfers.",
      }
    }

    return {
      ok: true,
      method_type: "momo",
      type: "mobile_money",
      provider_code: provider.code,
      provider_name: provider.label,
      momo_number: momoNumber,
      account_name: accountName,
      fingerprint: destinationFingerprint({
        business_id: input.businessId,
        staff_id: input.staffId,
        method_type: "momo",
        momo_provider: provider.code,
        momo_number: momoNumber,
        account_name: accountName,
      }),
    }
  }

  return {
    ok: false,
    code: "PAYSTACK_DESTINATION_UNSUPPORTED",
    message: "Paystack salary transfers require a bank or Mobile Money destination.",
  }
}

export function buildPaystackRecipientInput(
  destination: Extract<PaystackPayoutDestination, { ok: true }>
): PaystackRecipientInput {
  if (destination.method_type === "bank") {
    return {
      type: "ghipss",
      name: destination.account_name,
      account_number: destination.account_number,
      bank_code: destination.bank_code,
      currency: "GHS",
      description: "Finza payroll salary recipient",
    }
  }

  return {
    type: "mobile_money",
    name: destination.account_name,
    account_number: destination.momo_number,
    bank_code: destination.provider_code,
    currency: "GHS",
    description: "Finza payroll salary recipient",
  }
}

export function maskAccountNumber(value: string | null | undefined): string {
  const raw = String(value ?? "").replace(/\s+/g, "")
  if (!raw) return "—"
  if (raw.length <= 4) return `••${raw.slice(-2)}`
  return `${"•".repeat(Math.max(2, raw.length - 4))}${raw.slice(-4)}`
}

export function maskMomoNumber(value: string | null | undefined): string {
  const raw = String(value ?? "").replace(/\s+/g, "")
  if (!raw) return "—"
  return `${raw.slice(0, 3)}•••${raw.slice(-3)}`
}

export function destinationLabel(destination: FrozenBatchDestination): string {
  const method = String(destination.destination_method_type ?? "").toLowerCase()
  if (method === "momo") {
    return `${destination.destination_momo_provider || "Mobile Money"} ${maskMomoNumber(
      destination.destination_momo_number
    )}`
  }
  if (method === "bank") {
    return `${destination.destination_bank_name || "Bank"} ${maskAccountNumber(
      destination.destination_account_number
    )}`
  }
  return "Unsupported destination"
}

export function destinationForStorage(
  destination: Extract<PaystackPayoutDestination, { ok: true }>
): Record<string, string | null> {
  if (destination.method_type === "bank") {
    return {
      destination_method_type: "bank",
      destination_provider_name: null,
      destination_bank_name: destination.bank_name,
      destination_bank_code: destination.bank_code,
      destination_account_number: destination.account_number,
      destination_account_name: destination.account_name,
      destination_momo_provider: null,
      destination_momo_number: null,
    }
  }
  return {
    destination_method_type: "momo",
    destination_provider_name: destination.provider_name,
    destination_bank_name: null,
    destination_bank_code: null,
    destination_account_number: null,
    destination_account_name: destination.account_name,
    destination_momo_provider: destination.provider_code,
    destination_momo_number: destination.momo_number,
  }
}
