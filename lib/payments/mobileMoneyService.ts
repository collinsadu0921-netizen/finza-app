/**
 * Mobile Money Payment Service
 *
 * Provider-agnostic abstraction for:
 * - Hubtel
 * - Paystack
 * - Flutterwave
 *
 * Flow: Invoice Payment Request → MoMo Initiation → Provider Webhook →
 *       Payment Validation → Invoice Settlement → Ledger Posting → Notification
 *
 * Callers MUST ensure accounting is initialized before creating payment records
 * (ensureAccountingInitialized); otherwise payment INSERT trigger will roll back.
 */

import { createHmac } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

export type MobileMoneyProvider = "hubtel" | "paystack" | "flutterwave" | "mtn"

export interface InitiateMoMoInput {
  businessId: string
  invoiceId: string
  amount: number
  currency: string
  customerPhone: string
  customerEmail?: string
  provider: MobileMoneyProvider
  reference?: string
  description?: string
}

export interface InitiateMoMoResult {
  success: boolean
  reference: string
  providerReference?: string
  status: "PENDING" | "INITIATED" | "FAILED"
  error?: string
  /** URL for redirect or deep link if applicable */
  approvalUrl?: string
}

export interface WebhookPayload {
  provider: MobileMoneyProvider
  rawBody: string
  headers: Record<string, string>
}

export interface WebhookValidationResult {
  valid: boolean
  providerReference?: string
  amount?: number
  currency?: string
  status?: "success" | "failed" | "pending"
  payerPhone?: string
  transactionId?: string
  /** Paystack: custom metadata from charge / initialize (subscription, etc.). */
  metadata?: Record<string, unknown>
  error?: string
}

export interface SettlePaymentInput {
  supabase: SupabaseClient
  reference: string
  provider: MobileMoneyProvider
  providerReference?: string
  amount: number
  transactionId?: string
}

export interface SettlePaymentResult {
  success: boolean
  paymentId?: string
  invoiceId?: string
  alreadySettled?: boolean
  error?: string
}

/**
 * Generate idempotency key for webhook processing (by provider reference or transaction id)
 */
export function idempotencyKey(provider: MobileMoneyProvider, externalId: string): string {
  return `momo:${provider}:${externalId}`
}

/**
 * Initiate Mobile Money payment (provider-specific).
 * Does NOT insert payment record; caller must insert after successful initiation
 * and ensure accounting is initialized so trigger can post to ledger.
 */
export async function initiateMobileMoney(_input: InitiateMoMoInput): Promise<InitiateMoMoResult> {
  const reference = _input.reference ?? `INV-${_input.invoiceId.slice(0, 8)}-${Date.now()}`
  switch (_input.provider) {
    case "hubtel":
      return initiateHubtel({ ..._input, reference })
    case "paystack":
      return initiatePaystack({ ..._input, reference })
    case "flutterwave":
      return initiateFlutterwave({ ..._input, reference })
    case "mtn":
      return initiateMtn({ ..._input, reference })
    default:
      return {
        success: false,
        reference,
        status: "FAILED",
        error: `Unsupported provider: ${_input.provider}`,
      }
  }
}

async function initiateHubtel(input: InitiateMoMoInput & { reference: string }): Promise<InitiateMoMoResult> {
  const clientId = process.env.HUBTEL_CLIENT_ID
  const clientSecret = process.env.HUBTEL_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return { success: false, reference: input.reference!, status: "FAILED", error: "Hubtel not configured" }
  }
  // TODO: Hubtel API call (e.g. collect request)
  return { success: true, reference: input.reference!, status: "PENDING", providerReference: input.reference }
}

async function initiatePaystack(input: InitiateMoMoInput & { reference: string }): Promise<InitiateMoMoResult> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY
  if (!secretKey) {
    return { success: false, reference: input.reference, status: "FAILED", error: "Paystack not configured" }
  }

  // Paystack mobile money provider codes for Ghana
  const providerCodes: Record<string, string> = {
    mtn: "mtn",
    vodafone: "vod",
    airteltigo: "atl",
  }
  const momoProvider = providerCodes[input.provider] ?? "mtn"

  // Paystack amounts are in the smallest currency unit (pesewas for GHS, kobo for NGN)
  const amountInSmallestUnit = Math.round(input.amount * 100)

  // Paystack requires an email; use a deterministic placeholder when the caller
  // doesn't supply one (public-facing /pay page where no customer email is known)
  const email =
    input.customerEmail?.trim() ||
    `payment.${input.invoiceId.slice(0, 8)}@finza-noreply.africa`

  const res = await fetch("https://api.paystack.co/charge", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amountInSmallestUnit,
      email,
      currency: input.currency || "GHS",
      reference: input.reference,
      mobile_money: {
        phone: input.customerPhone,
        provider: momoProvider,
      },
      metadata: {
        invoice_id: input.invoiceId,
        business_id: input.businessId,
      },
    }),
  })

  const data = await res.json()

  if (!res.ok || !data.status) {
    return {
      success: false,
      reference: input.reference,
      status: "FAILED",
      error: data.message || `Paystack error ${res.status}`,
    }
  }

  const chargeStatus: string = data.data?.status ?? "pending"
  const failed = chargeStatus === "failed" || chargeStatus === "error"

  return {
    success: !failed,
    reference: input.reference,
    providerReference: data.data?.reference ?? input.reference,
    // "pay_offline" = push prompt on phone (MTN/AirtelTigo)
    // "send_otp"   = customer must enter OTP  (Vodafone)
    // "success"    = instant confirmation
    status: failed ? "FAILED" : "PENDING",
    error: failed ? (data.data?.gateway_response || data.message) : undefined,
    // Signal OTP requirement to the caller via approvalUrl
    approvalUrl: chargeStatus === "send_otp" ? "otp_required" : undefined,
  }
}

async function initiateFlutterwave(input: InitiateMoMoInput & { reference: string }): Promise<InitiateMoMoResult> {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY
  if (!secretKey) {
    return { success: false, reference: input.reference!, status: "FAILED", error: "Flutterwave not configured" }
  }
  // TODO: Flutterwave mobile money initiation
  return { success: true, reference: input.reference!, status: "PENDING", providerReference: input.reference }
}

async function initiateMtn(input: InitiateMoMoInput & { reference: string }): Promise<InitiateMoMoResult> {
  const apiKey = process.env.MTN_MOMO_API_KEY
  if (!apiKey) {
    return { success: true, reference: input.reference!, status: "PENDING" }
  }
  // MTN MoMo request-to-pay: use existing app/api/payments/momo/initiate or delegate here
  return { success: true, reference: input.reference!, status: "PENDING", providerReference: input.reference }
}

/**
 * Validate webhook signature and parse payload (provider-specific).
 */
export function validateWebhookSignature(payload: WebhookPayload): WebhookValidationResult {
  switch (payload.provider) {
    case "hubtel":
      return validateHubtelWebhook(payload)
    case "paystack":
      return validatePaystackWebhook(payload)
    case "flutterwave":
      return validateFlutterwaveWebhook(payload)
    case "mtn":
      return validateMtnWebhook(payload)
    default:
      return { valid: false, error: `Unknown provider: ${payload.provider}` }
  }
}

function validateHubtelWebhook(payload: WebhookPayload): WebhookValidationResult {
  const secret = process.env.HUBTEL_WEBHOOK_SECRET
  const sig = payload.headers["x-hubtel-signature"] ?? payload.headers["x-signature"]
  if (!secret || !sig) return { valid: false, error: "Hubtel webhook secret or signature missing" }
  // TODO: HMAC verify rawBody with secret
  try {
    const body = JSON.parse(payload.rawBody) as any
    return {
      valid: true,
      providerReference: body.data?.clientReference ?? body.reference,
      amount: Number(body.data?.amount ?? body.amount),
      currency: body.data?.currency ?? body.currency,
      status: body.data?.status === "Success" ? "success" : body.data?.status === "Failed" ? "failed" : "pending",
      transactionId: body.data?.transactionId ?? body.transactionId,
      payerPhone: body.data?.payer?.phoneNumber ?? body.payerPhone,
    }
  } catch {
    return { valid: false, error: "Invalid Hubtel payload" }
  }
}

function validatePaystackWebhook(payload: WebhookPayload): WebhookValidationResult {
  const secret = process.env.PAYSTACK_SECRET_KEY
  const sig = payload.headers["x-paystack-signature"]
  if (!secret || !sig) return { valid: false, error: "Paystack secret or signature missing" }

  // HMAC-SHA512 signature verification
  const expected = createHmac("sha512", secret)
    .update(payload.rawBody)
    .digest("hex")
  if (expected !== sig) {
    return { valid: false, error: "Paystack signature mismatch" }
  }

  try {
    const body = JSON.parse(payload.rawBody) as any
    const event = String(body.event ?? "")
    const dataStatus = String(body.data?.status ?? "")
    const eventStatus: "success" | "failed" | "pending" =
      event === "charge.success" || dataStatus === "success"
        ? "success"
        : event === "charge.failed" || dataStatus === "failed"
          ? "failed"
          : "pending"
    const meta = body.data?.metadata
    const metadata =
      meta && typeof meta === "object" && !Array.isArray(meta)
        ? (meta as Record<string, unknown>)
        : undefined
    return {
      valid: true,
      providerReference: body.data?.reference,
      // Paystack amounts are in smallest unit (pesewas) — convert back to major unit
      amount: body.data?.amount != null ? Number(body.data.amount) / 100 : undefined,
      currency: body.data?.currency,
      status: eventStatus,
      transactionId: body.data?.id?.toString(),
      payerPhone: body.data?.authorization?.mobile_money_number,
      metadata,
    }
  } catch {
    return { valid: false, error: "Invalid Paystack payload" }
  }
}

function validateFlutterwaveWebhook(payload: WebhookPayload): WebhookValidationResult {
  const secret = process.env.FLUTTERWAVE_WEBHOOK_SECRET ?? process.env.FLUTTERWAVE_SECRET_KEY
  const sig = payload.headers["verif-hash"] ?? payload.headers["x-flutterwave-signature"]
  if (!secret || !sig) return { valid: false, error: "Flutterwave secret or signature missing" }
  try {
    const body = JSON.parse(payload.rawBody) as any
    return {
      valid: true,
      providerReference: body.data?.tx_ref,
      amount: Number(body.data?.amount),
      currency: body.data?.currency,
      status: body.data?.status === "successful" ? "success" : body.data?.status === "failed" ? "failed" : "pending",
      transactionId: body.data?.id?.toString(),
    }
  } catch {
    return { valid: false, error: "Invalid Flutterwave payload" }
  }
}

function validateMtnWebhook(payload: WebhookPayload): WebhookValidationResult {
  try {
    const body = JSON.parse(payload.rawBody) as any
    const status = (body.status ?? body.Status)?.toLowerCase()
    return {
      valid: true,
      providerReference: body.externalId ?? body.external_id,
      amount: Number(body.amount ?? 0),
      currency: body.currency ?? "GHS",
      status: status === "successful" ? "success" : status === "failed" ? "failed" : "pending",
      transactionId: body.financialTransactionId ?? body.financial_transaction_id,
      payerPhone: body.payer?.partyId ?? body.payer?.party_id,
    }
  } catch {
    return { valid: false, error: "Invalid MTN payload" }
  }
}

/**
 * Reconcile webhook to existing payment by reference; then rely on DB trigger for ledger.
 * If payment already exists and is not in a "pending" state, treat as idempotent success.
 * Does NOT create payment; expects payment to have been created on initiate (or create here only when provider does not support pre-create).
 */
export async function settlePaymentFromWebhook(input: SettlePaymentInput): Promise<SettlePaymentResult> {
  const { supabase, reference, provider, amount, transactionId } = input
  const existing = await supabase
    .from("payments")
    .select("id, invoice_id, amount, reference, method")
    .eq("reference", reference)
    .is("deleted_at", null)
    .maybeSingle()

  if (existing.data) {
    const p = existing.data as { id: string; invoice_id: string; amount: number }
    if (Number(p.amount) === amount) {
      return { success: true, paymentId: p.id, invoiceId: p.invoice_id, alreadySettled: true }
    }
  }

  const byExternalId = await supabase
    .from("payments")
    .select("id, invoice_id, amount, reference")
    .eq("reference", reference)
    .is("deleted_at", null)
    .maybeSingle()

  if (byExternalId.data) {
    return { success: true, paymentId: byExternalId.data.id, invoiceId: (byExternalId.data as any).invoice_id, alreadySettled: true }
  }

  return { success: false, error: "Payment record not found for reference; create payment on initiate or implement webhook-create flow" }
}
