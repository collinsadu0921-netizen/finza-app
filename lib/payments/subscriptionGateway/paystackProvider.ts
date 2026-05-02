import "server-only"

import type { SubscriptionInitiateContext } from "./types"
import { resolvePublicAppOrigin } from "./resolvePublicAppOrigin"
import type { NextRequest } from "next/server"

const MOMO_PROVIDER_CODES: Record<string, string> = {
  mtn: "mtn",
  vodafone: "vod",
  airteltigo: "atl",
}

export type PaystackInitiateMomoResult =
  | {
      success: true
      channel: "momo"
      reference: string
      status: string
      otp_required: boolean
      display_text: string | null
      gateway_response: string | null
    }
  | { success: false; error: string; httpStatus: number }

const PAYSTACK_SUBSCRIPTION_MOMO_OK_STATUSES = new Set(["send_otp", "pay_offline", "pending", "success"])
const PAYSTACK_SUBSCRIPTION_MOMO_FAILED_STATUSES = new Set(["failed", "error"])

/** Paystack often sets message to this even when data.status is failed — avoid showing it as the user-facing error. */
const PAYSTACK_CHARGE_ATTEMPTED_MESSAGE = "Charge attempted"

const SUBSCRIPTION_MOMO_FAILED_FALLBACK =
  "Mobile Money charge failed. Please check the number and try again."

function subscriptionMomoFailedChargeUserMessage(
  gatewayResponse: string | null,
  topMessage: string | null
): string {
  if (gatewayResponse) return gatewayResponse
  if (!topMessage || topMessage === PAYSTACK_CHARGE_ATTEMPTED_MESSAGE) {
    return SUBSCRIPTION_MOMO_FAILED_FALLBACK
  }
  return topMessage
}

function subscriptionMomoSafeString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * Interprets Paystack `/charge` JSON for subscription Mobile Money.
 * Exported for unit tests. Do not log secrets or phone numbers here.
 */
export function interpretPaystackSubscriptionMomoChargeResponse(
  psData: Record<string, unknown>,
  paystackHttpOk: boolean,
  ctxReference: string
): PaystackInitiateMomoResult {
  const dataObj = asRecord(psData.data)

  const rawStatus = dataObj ? subscriptionMomoSafeString(dataObj.status) : null
  const chargeNorm = rawStatus ? rawStatus.toLowerCase() : ""

  const gatewayResponse = dataObj ? subscriptionMomoSafeString(dataObj.gateway_response) : null
  const displayText = dataObj ? subscriptionMomoSafeString(dataObj.display_text) : null
  const topMessage = subscriptionMomoSafeString(psData.message)

  const topStatusOk = psData.status === true

  if (chargeNorm && PAYSTACK_SUBSCRIPTION_MOMO_FAILED_STATUSES.has(chargeNorm)) {
    return {
      success: false,
      error: subscriptionMomoFailedChargeUserMessage(gatewayResponse, topMessage),
      httpStatus: 402,
    }
  }

  if (chargeNorm && PAYSTACK_SUBSCRIPTION_MOMO_OK_STATUSES.has(chargeNorm)) {
    return {
      success: true,
      channel: "momo",
      reference: ctxReference,
      status: rawStatus!,
      otp_required: chargeNorm === "send_otp",
      display_text: displayText,
      gateway_response: gatewayResponse,
    }
  }

  // No usable data.status — rely on HTTP / top-level API flag
  if (!paystackHttpOk || !topStatusOk) {
    return {
      success: false,
      error: gatewayResponse || topMessage || "Paystack charge failed",
      httpStatus: 502,
    }
  }

  return {
    success: false,
    error: gatewayResponse || topMessage || "Paystack charge failed",
    httpStatus: 502,
  }
}

export type PaystackInitiateCardResult =
  | {
      success: true
      channel: "card"
      reference: string
      authorization_url: string
      access_code: string | null
    }
  | { success: false; error: string; httpStatus: number }

export async function paystackInitiateSubscriptionMomo(
  secretKey: string,
  ctx: SubscriptionInitiateContext
): Promise<PaystackInitiateMomoResult> {
  const momoKey = ctx.momoProviderKey ?? ""
  const phone = ctx.phone?.replace(/\s+/g, "") ?? ""
  if (!phone || !momoKey) {
    return { success: false, error: "phone and momo_provider (mtn|vodafone|airteltigo) are required for MoMo", httpStatus: 400 }
  }

  const paystackRes = await fetch("https://api.paystack.co/charge", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: ctx.amountPesewas,
      email: ctx.email,
      currency: "GHS",
      reference: ctx.reference,
      mobile_money: {
        phone: phone.replace(/^0/, "+233"),
        provider: MOMO_PROVIDER_CODES[momoKey] ?? "mtn",
      },
      metadata: ctx.metadata,
    }),
  })

  let psData: Record<string, unknown>
  try {
    const raw: unknown = await paystackRes.json()
    psData = asRecord(raw) ?? {}
  } catch {
    return { success: false, error: "Paystack charge failed", httpStatus: 502 }
  }

  return interpretPaystackSubscriptionMomoChargeResponse(psData, paystackRes.ok, ctx.reference)
}

export async function paystackInitiateSubscriptionCard(
  secretKey: string,
  request: NextRequest,
  ctx: SubscriptionInitiateContext
): Promise<PaystackInitiateCardResult> {
  const appUrl = resolvePublicAppOrigin(request)
  const callback_url = `${appUrl}/service/settings/subscription?sub_callback=1&business_id=${encodeURIComponent(ctx.businessId)}`

  const initRes = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: ctx.email,
      amount: ctx.amountPesewas,
      currency: "GHS",
      reference: ctx.reference,
      callback_url,
      metadata: ctx.metadata,
      channels: ["card"],
    }),
  })

  const initData = await initRes.json()
  if (!initRes.ok || !initData.status) {
    return { success: false, error: initData.message || "Paystack initialize failed", httpStatus: 502 }
  }

  const authUrl = initData.data?.authorization_url as string | undefined
  if (!authUrl) {
    return { success: false, error: "No authorization URL returned", httpStatus: 502 }
  }

  return {
    success: true,
    channel: "card",
    reference: ctx.reference,
    authorization_url: authUrl,
    access_code: initData.data?.access_code ?? null,
  }
}

export async function paystackVerifyTransaction(
  secretKey: string,
  reference: string
): Promise<{
  status: string
  gateway_response?: string
  amount: number | null
  reference?: string
  error?: string
}> {
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
    cache: "no-store",
  })

  const data = await res.json()

  if (!res.ok || !data.status) {
    return { status: "pending", error: data.message, amount: null }
  }

  const chargeStatus: string = data.data?.status ?? "pending"

  return {
    status: chargeStatus,
    gateway_response: data.data?.gateway_response,
    amount: data.data?.amount != null ? Number(data.data.amount) / 100 : null,
    reference: data.data?.reference,
  }
}
