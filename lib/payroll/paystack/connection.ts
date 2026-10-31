import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  decryptProviderSecretConfig,
  encryptProviderSecretConfig,
} from "@/lib/tenantPayments/encryptProviderSecrets"
import {
  maskPaystackSecretKey,
  paystackKeyEnvironment,
  type PaystackEnvironment,
} from "./paystackClient"

export const PAYSTACK_PAYROLL_TABLE = "business_paystack_payroll_accounts"

export type PaystackPayrollConnectionRow = {
  id: string
  business_id: string
  environment: PaystackEnvironment
  secret_key_encrypted: string | null
  status: string
  validation_status: string
  validated_at: string | null
  last_balance_pesewas: number | null
  last_balance_checked_at: string | null
  last_error: string | null
  clearing_account_id: string | null
  fee_account_id: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export function isPaystackLiveTransfersEnabled(): boolean {
  return String(process.env.PAYSTACK_PAYROLL_LIVE_ENABLED ?? "").trim().toLowerCase() === "true"
}

export function expectedPaystackEnvironmentForRuntime(): PaystackEnvironment {
  const explicit = String(process.env.PAYSTACK_PAYROLL_ENVIRONMENT ?? "").trim().toLowerCase()
  if (explicit === "live" || explicit === "test") return explicit
  return "test"
}

export function encryptPaystackSecretKey(secretKey: string): string {
  return encryptProviderSecretConfig({ secret_key: secretKey })
}

export function decryptPaystackSecretKey(ciphertext: string | null): string | null {
  if (!ciphertext) return null
  const decrypted = decryptProviderSecretConfig(ciphertext)
  const key = decrypted.secret_key
  return typeof key === "string" && key.trim() ? key.trim() : null
}

export async function loadPaystackPayrollConnection(
  admin: SupabaseClient,
  businessId: string
): Promise<{ row: PaystackPayrollConnectionRow; secretKey: string | null } | null> {
  const { data, error } = await admin
    .from(PAYSTACK_PAYROLL_TABLE)
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle()

  if (error) throw new Error(`Paystack connection lookup failed: ${error.message}`)
  if (!data) return null

  const row = data as unknown as PaystackPayrollConnectionRow
  let secretKey: string | null = null
  if (row.secret_key_encrypted) {
    try {
      secretKey = decryptPaystackSecretKey(row.secret_key_encrypted)
    } catch {
      secretKey = null
    }
  }
  return { row, secretKey }
}

export function publicPaystackConnectionView(
  row: PaystackPayrollConnectionRow | null,
  secretKey: string | null
): {
  connected: boolean
  status: string
  environment: PaystackEnvironment | null
  validation_status: string
  masked_key: string | null
  balance_pesewas: number | null
  balance_checked_at: string | null
  last_error: string | null
  clearing_account_id: string | null
  fee_account_id: string | null
} {
  if (!row) {
    return {
      connected: false,
      status: "disconnected",
      environment: null,
      validation_status: "unvalidated",
      masked_key: null,
      balance_pesewas: null,
      balance_checked_at: null,
      last_error: null,
      clearing_account_id: null,
      fee_account_id: null,
    }
  }
  return {
    connected: row.is_active && row.status === "connected" && Boolean(secretKey),
    status: row.status,
    environment: row.environment,
    validation_status: row.validation_status,
    masked_key: secretKey ? maskPaystackSecretKey(secretKey) : null,
    balance_pesewas: row.last_balance_pesewas,
    balance_checked_at: row.last_balance_checked_at,
    last_error: row.last_error,
    clearing_account_id: row.clearing_account_id,
    fee_account_id: row.fee_account_id,
  }
}

export function validatePaystackSecretForEnvironment(
  secretKey: string,
  environment: PaystackEnvironment
): { ok: true } | { ok: false; message: string } {
  const keyEnv = paystackKeyEnvironment(secretKey)
  if (!keyEnv) {
    return { ok: false, message: "Enter a Paystack secret key beginning with sk_test_ or sk_live_." }
  }
  if (keyEnv !== environment) {
    return {
      ok: false,
      message:
        environment === "test"
          ? "This is not a Paystack test secret key."
          : "This is not a Paystack live secret key.",
    }
  }
  return { ok: true }
}

/** Tenant-specific webhook URL shown in settings. */
export function paystackPayrollWebhookPath(): string {
  return "/api/webhooks/paystack/payroll"
}

export function paystackPayrollWebhookUrl(origin: string): string {
  const base = origin.replace(/\/$/, "")
  return `${base}${paystackPayrollWebhookPath()}`
}
