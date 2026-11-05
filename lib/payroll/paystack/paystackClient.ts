import "server-only"

import { createHash, createHmac, timingSafeEqual } from "crypto"
import { ghsToPesewas } from "./amounts"

export const PAYSTACK_API_BASE = "https://api.paystack.co"

/**
 * Clearly identified staging-only provider mock. Never active in production,
 * even if the environment variable is accidentally set there.
 */
export function isPaystackPayrollMockMode(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const vercelEnv = String(env.VERCEL_ENV ?? env.NEXT_PUBLIC_VERCEL_ENV ?? "").toLowerCase()
  const productionLike = vercelEnv === "production" || (!vercelEnv && env.NODE_ENV === "production")
  return String(env.PAYSTACK_PAYROLL_MOCK_MODE ?? "").toLowerCase() === "true" && !productionLike
}

function mockId(reference: string, prefix: string): string {
  const hash = createHash("sha256").update(reference, "utf8").digest("hex").slice(0, 16)
  return `${prefix}_${hash}`
}

const mockTransferStore = new Map<
  string,
  { amount: number; currency: "GHS"; recipient: string; status: string; fee: number }
>()

export type PaystackEnvironment = "test" | "live"

export type PaystackApiResult<T = Record<string, unknown>> =
  | { ok: true; httpStatus: number; data: T; message: string | null }
  | { ok: false; httpStatus: number; error: string; code?: string; data?: Record<string, unknown> }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export function paystackKeyEnvironment(secretKey: string): PaystackEnvironment | null {
  const key = String(secretKey ?? "").trim()
  if (key.startsWith("sk_test_")) return "test"
  if (key.startsWith("sk_live_")) return "live"
  return null
}

export function maskPaystackSecretKey(secretKey: string): string {
  const key = String(secretKey ?? "").trim()
  if (key.length <= 12) return "••••"
  return `${key.slice(0, 8)}••••${key.slice(-4)}`
}

async function paystackRequest(
  secretKey: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 20_000
): Promise<PaystackApiResult> {
  const key = String(secretKey ?? "").trim()
  if (!key) return { ok: false, httpStatus: 0, error: "Paystack secret key is missing" }

  let response: Response
  try {
    response = await fetch(`${PAYSTACK_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    })
  } catch (error) {
    const timedOut = error instanceof Error && /timeout|abort/i.test(error.name + error.message)
    return {
      ok: false,
      httpStatus: 0,
      error: timedOut
        ? "Paystack did not respond in time. The transfer outcome is uncertain; verify before retrying."
        : "Could not reach Paystack. The transfer outcome is uncertain; verify before retrying.",
      code: timedOut ? "PAYSTACK_TIMEOUT" : "PAYSTACK_NETWORK_ERROR",
    }
  }

  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await response.json()
    body = asRecord(parsed) ?? {}
  } catch {
    body = {}
  }

  const ok = response.ok && body.status === true
  if (!ok) {
    const message =
      safeString(body.message) ||
      (response.status === 401 ? "Paystack rejected the secret key" : "Paystack request failed")
    return {
      ok: false,
      httpStatus: response.status,
      error: message,
      code: response.status === 401 ? "PAYSTACK_UNAUTHORIZED" : "PAYSTACK_REQUEST_FAILED",
      data: body,
    }
  }

  const data = asRecord(body.data) ?? (Array.isArray(body.data) ? ({ items: body.data } as Record<string, unknown>) : {})
  return {
    ok: true,
    httpStatus: response.status,
    data,
    message: safeString(body.message),
  }
}

export async function fetchPaystackGhsBalancePesewas(
  secretKey: string
): Promise<PaystackApiResult<{ balance_pesewas: number | null }>> {
  if (isPaystackPayrollMockMode()) {
    return {
      ok: true,
      httpStatus: 200,
      data: { balance_pesewas: 100_000_000 },
      message: "Mock Paystack GHS balance",
    }
  }

  const result = await paystackRequest(secretKey, "/balance", { method: "GET" })
  if (!result.ok) return result

  const rows = Array.isArray(result.data.items)
    ? (result.data.items as unknown[])
    : Array.isArray(result.data)
      ? (result.data as unknown[])
      : []
  const ghs = rows
    .map((row) => asRecord(row))
    .find((row) => row && String(row.currency ?? "").toUpperCase() === "GHS")

  const rawBalance = ghs?.balance
  const balance =
    rawBalance == null || rawBalance === ""
      ? null
      : Number.isFinite(Number(rawBalance))
        ? Math.round(Number(rawBalance))
        : null

  return {
    ok: true,
    httpStatus: result.httpStatus,
    data: { balance_pesewas: balance },
    message: result.message,
  }
}

export type PaystackBank = {
  name: string
  code: string
  type: string | null
  currency: string | null
  active: boolean
}

export async function listPaystackGhanaBanks(
  secretKey: string,
  type?: "ghipss" | "mobile_money"
): Promise<PaystackApiResult<{ banks: PaystackBank[] }>> {
  if (isPaystackPayrollMockMode()) {
    const banks: PaystackBank[] =
      type === "mobile_money"
        ? [
            { name: "MTN", code: "MTN", type: "mobile_money", currency: "GHS", active: true },
            { name: "Vodafone", code: "VOD", type: "mobile_money", currency: "GHS", active: true },
            { name: "AirtelTigo", code: "ATL", type: "mobile_money", currency: "GHS", active: true },
          ]
        : [
            { name: "GCB Bank", code: "GH050100", type: "ghipss", currency: "GHS", active: true },
            { name: "Ecobank Ghana", code: "GH130100", type: "ghipss", currency: "GHS", active: true },
            { name: "Fidelity Bank", code: "GH240100", type: "ghipss", currency: "GHS", active: true },
          ]
    return { ok: true, httpStatus: 200, data: { banks }, message: "Mock Paystack bank list" }
  }

  const params = new URLSearchParams({ currency: "GHS" })
  if (type) params.set("type", type)

  const result = await paystackRequest(secretKey, `/bank?${params.toString()}`, { method: "GET" })
  if (!result.ok) return result

  const rows = Array.isArray(result.data.items)
    ? (result.data.items as unknown[])
    : Array.isArray(result.data)
      ? (result.data as unknown[])
      : []

  const banks: PaystackBank[] = rows
    .map((row) => asRecord(row))
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .map((row) => ({
      name: String(row.name ?? "").trim(),
      code: String(row.code ?? "").trim(),
      type: safeString(row.type),
      currency: safeString(row.currency),
      active: row.active !== false,
    }))
    .filter((bank) => bank.name && bank.code && bank.active)

  return {
    ok: true,
    httpStatus: result.httpStatus,
    data: { banks },
    message: result.message,
  }
}

export type PaystackRecipientInput = {
  type: "ghipss" | "mobile_money"
  name: string
  account_number: string
  bank_code: string
  currency: "GHS"
  description?: string
  metadata?: Record<string, unknown>
}

export async function createPaystackRecipient(
  secretKey: string,
  input: PaystackRecipientInput
): Promise<PaystackApiResult<{ recipient_code: string; domain: string | null; type: string | null }>> {
  if (isPaystackPayrollMockMode()) {
    return {
      ok: true,
      httpStatus: 200,
      data: {
        recipient_code: mockId(`${input.type}:${input.bank_code}:${input.account_number}`, "RCP_mock"),
        domain: "test",
        type: input.type,
      },
      message: "Mock recipient created",
    }
  }

  const result = await paystackRequest(secretKey, "/transferrecipient", {
    method: "POST",
    body: JSON.stringify(input),
  })
  if (!result.ok) return result

  const recipientCode = safeString(result.data.recipient_code)
  if (!recipientCode) {
    return { ok: false, httpStatus: result.httpStatus, error: "Paystack did not return a recipient code" }
  }

  return {
    ok: true,
    httpStatus: result.httpStatus,
    data: {
      recipient_code: recipientCode,
      domain: safeString(result.data.domain),
      type: safeString(result.data.type),
    },
    message: result.message,
  }
}

export type PaystackTransferInput = {
  source: "balance"
  amount: number
  recipient: string
  reason: string
  reference: string
  currency: "GHS"
}

export async function initiatePaystackTransfer(
  secretKey: string,
  input: PaystackTransferInput
): Promise<PaystackApiResult<Record<string, unknown>>> {
  if (isPaystackPayrollMockMode()) {
    mockTransferStore.set(input.reference, {
      amount: input.amount,
      currency: "GHS",
      recipient: input.recipient,
      status: "success",
      fee: 100,
    })
    return {
      ok: true,
      httpStatus: 200,
      data: {
        id: mockId(input.reference, "mock_transfer"),
        reference: input.reference,
        status: "success",
        amount: input.amount,
        currency: "GHS",
        transfer_code: mockId(input.reference, "TRF_mock"),
        fee: 100,
        transferred_at: new Date().toISOString(),
        gateway_response: "Mock Paystack transfer approved",
        recipient: { recipient_code: input.recipient },
      },
      message: "Mock transfer successful",
    }
  }

  return paystackRequest(secretKey, "/transfer", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function finalizePaystackTransfer(
  secretKey: string,
  transferCode: string,
  otp: string
): Promise<PaystackApiResult<Record<string, unknown>>> {
  if (isPaystackPayrollMockMode()) {
    return {
      ok: true,
      httpStatus: 200,
      data: {
        id: mockId(transferCode, "mock_transfer"),
        status: "success",
        transfer_code: transferCode,
        amount: 0,
        currency: "GHS",
        fee: 100,
      },
      message: "Mock transfer authorized",
    }
  }

  return paystackRequest(secretKey, "/transfer/finalize_transfer", {
    method: "POST",
    body: JSON.stringify({ transfer_code: transferCode, otp }),
  })
}

export async function verifyPaystackTransfer(
  secretKey: string,
  reference: string
): Promise<PaystackApiResult<Record<string, unknown>>> {
  if (isPaystackPayrollMockMode()) {
    const stored = mockTransferStore.get(reference)
    if (!stored) {
      return {
        ok: false,
        httpStatus: 404,
        error: "Mock transfer not found",
        code: "PAYSTACK_TRANSFER_NOT_FOUND",
      }
    }
    return {
      ok: true,
      httpStatus: 200,
      data: {
        id: mockId(reference, "mock_transfer"),
        reference,
        status: stored.status,
        amount: stored.amount,
        currency: stored.currency,
        transfer_code: mockId(reference, "TRF_mock"),
        fee: stored.fee,
        transferred_at: new Date().toISOString(),
        gateway_response: "Mock Paystack transfer verified",
        recipient: { recipient_code: stored.recipient },
      },
      message: "Mock transfer verified",
    }
  }

  return paystackRequest(secretKey, `/transfer/verify/${encodeURIComponent(reference)}`, {
    method: "GET",
  })
}

/** HMAC-SHA512 over the exact raw request body using the tenant's secret key. */
export function verifyPaystackWebhookSignature(
  rawBody: string,
  signature: string | null,
  secretKey: string
): boolean {
  if (!rawBody || !signature || !secretKey) return false
  const expected = createHmac("sha512", secretKey).update(rawBody, "utf8").digest("hex")
  const a = Buffer.from(expected, "utf8")
  const b = Buffer.from(signature.trim().toLowerCase(), "utf8")
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export type PaystackTransferStatus =
  | "awaiting_authorization"
  | "pending"
  | "successful"
  | "failed"
  | "reversed"
  | "requires_attention"

export function normalizePaystackTransferStatus(rawStatus: unknown): PaystackTransferStatus {
  const status = String(rawStatus ?? "").trim().toLowerCase()
  if (["success", "successful", "completed", "processed"].includes(status)) return "successful"
  if (["reversed", "reversal"].includes(status)) return "reversed"
  if (["failed", "declined", "abandoned", "error"].includes(status)) return "failed"
  if (["otp", "send_otp", "awaiting_otp", "awaiting_authorization", "authorization_required"].includes(status)) {
    return "awaiting_authorization"
  }
  if (["pending", "processing", "queued", "ongoing", "new"].includes(status)) return "pending"
  return "requires_attention"
}

/** Paystack reports transfer fees in pesewas when available. */
export function extractPaystackTransferFeePesewas(data: Record<string, unknown> | null | undefined): number | null {
  if (!data) return null
  const direct = data.fee ?? data.transfer_fee
  if (direct != null && Number.isFinite(Number(direct))) return Math.round(Number(direct))

  const breakdown = data.fees_breakdown
  if (Array.isArray(breakdown)) {
    let total = 0
    let found = false
    for (const item of breakdown) {
      const row = asRecord(item)
      const amount = row?.amount ?? row?.fee
      if (amount != null && Number.isFinite(Number(amount))) {
        total += Math.round(Number(amount))
        found = true
      }
    }
    if (found) return total
  }
  return null
}

const SAFE_PROVIDER_MESSAGES: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /insufficient (balance|funds)|low balance/i,
    message: "Your Paystack balance is too low to fund this salary transfer.",
  },
  {
    pattern: /recipient.*(invalid|not found|inactive)|invalid recipient/i,
    message: "Paystack could not validate this employee payout destination.",
  },
  {
    pattern: /otp|authorization/i,
    message: "Paystack requires authorization for this transfer.",
  },
  {
    pattern: /duplicate|already exists|reference/i,
    message: "Paystack reported a duplicate or uncertain transfer. Verify the status before retrying.",
  },
  {
    pattern: /account.*(invalid|mismatch)|cannot resolve|name.*mismatch/i,
    message: "The employee payout account could not be verified. Check the account details.",
  },
]

/** Customer-facing message; never surfaces raw provider internals as the primary message. */
export function safePaystackPayrollMessage(raw: string | null | undefined): string {
  const text = String(raw ?? "").trim()
  if (!text) return "Paystack could not complete this salary transfer."
  for (const entry of SAFE_PROVIDER_MESSAGES) {
    if (entry.pattern.test(text)) return entry.message
  }
  return "Paystack could not complete this salary transfer. Verify the transfer status before trying again."
}

/** Extracts provider data from a transfer/verify/webhook payload. */
export function paystackTransferData(payload: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!payload) return null
  return asRecord(payload.data) ?? payload
}

export function paystackTransferAmountPesewas(data: Record<string, unknown> | null | undefined): number | null {
  if (!data) return null
  const amount = data.amount
  return amount != null && Number.isFinite(Number(amount)) ? Math.round(Number(amount)) : null
}

export function paystackTransferCurrency(data: Record<string, unknown> | null | undefined): string | null {
  return safeString(data?.currency)?.toUpperCase() ?? null
}

export function paystackTransferReference(data: Record<string, unknown> | null | undefined): string | null {
  return safeString(data?.reference)
}

export function paystackFeeFromTransfer(data: Record<string, unknown> | null | undefined): number | null {
  return extractPaystackTransferFeePesewas(data)
}

/** Validates a GHS amount before sending to Paystack. */
export function assertPaystackGhsAmount(amount: unknown): number | null {
  return ghsToPesewas(amount)
}
