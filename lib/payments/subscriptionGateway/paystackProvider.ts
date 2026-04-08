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
    }
  | { success: false; error: string; httpStatus: number }

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

  const psData = await paystackRes.json()
  if (!paystackRes.ok || !psData.status) {
    return { success: false, error: psData.message || "Paystack charge failed", httpStatus: 502 }
  }

  const chargeStatus: string = psData.data?.status ?? "pending"
  const failed = chargeStatus === "failed" || chargeStatus === "error"
  if (failed) {
    return { success: false, error: psData.data?.gateway_response || "Charge was declined", httpStatus: 402 }
  }

  return {
    success: true,
    channel: "momo",
    reference: ctx.reference,
    status: chargeStatus,
    otp_required: chargeStatus === "send_otp",
    display_text: psData.data?.display_text ?? null,
  }
}

export async function paystackInitiateSubscriptionCard(
  secretKey: string,
  request: NextRequest,
  ctx: SubscriptionInitiateContext
): Promise<PaystackInitiateCardResult> {
  const appUrl = resolvePublicAppOrigin(request)
  const callback_url = `${appUrl}/service/settings/subscription?sub_callback=1`

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
