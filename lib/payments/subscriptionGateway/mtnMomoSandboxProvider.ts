import "server-only"

import { randomUUID } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  fetchMtnCollectionAccessToken,
  getRequestToPayStatus,
  normalizeGhanaMsisdnForMtn,
  requestToPayCollection,
  type MtnMomoDirectTenantCredentials,
} from "@/lib/tenantPayments/providers/mtnMomoDirect"
import {
  FINZA_PAYSTACK_METADATA_PURPOSE_KEY,
  applyPaystackSubscriptionWebhook,
} from "@/lib/serviceWorkspace/applyPaystackSubscriptionWebhook"
import type { SubscriptionInitiateContext } from "./types"
import { SUBSCRIPTION_PLATFORM_WORKSPACE, SUBSCRIPTION_PROVIDER_TYPE } from "./types"

const OPEN_TXN_STATUSES = ["initiated", "pending", "requires_action"] as const

function platformMtnSandboxCredsFromEnv(): MtnMomoDirectTenantCredentials | null {
  const apiUser = process.env.FINZA_MTN_SUBSCRIPTION_API_USER?.trim()
  const apiKey = process.env.FINZA_MTN_SUBSCRIPTION_API_KEY?.trim()
  const primarySubscriptionKey = process.env.FINZA_MTN_SUBSCRIPTION_PRIMARY_KEY?.trim()
  const targetEnvironment = process.env.FINZA_MTN_SUBSCRIPTION_TARGET_ENVIRONMENT?.trim() || "sandbox"
  if (!apiUser || !apiKey || !primarySubscriptionKey) return null
  return {
    apiUser,
    apiKey,
    primarySubscriptionKey,
    targetEnvironment,
  }
}

export function isMtnMomoSandboxSubscriptionConfigured(): boolean {
  return platformMtnSandboxCredsFromEnv() != null
}

export type MtnSandboxInitiateResult =
  | {
      success: true
      channel: "momo"
      reference: string
      status: string
      otp_required: false
      display_text: string | null
    }
  | { success: false; error: string; httpStatus: number }

/**
 * MTN Collection request-to-pay for platform subscription (sandbox or live credentials via env).
 * Persists `payment_provider_transactions` (workspace platform_subscription) for verify/callback.
 */
export async function mtnMomoSandboxInitiateSubscription(
  supabase: SupabaseClient,
  ctx: SubscriptionInitiateContext
): Promise<MtnSandboxInitiateResult> {
  const creds = platformMtnSandboxCredsFromEnv()
  if (!creds) {
    return { success: false, error: "MTN MoMo subscription gateway is not configured", httpStatus: 503 }
  }

  const phone = ctx.phone?.replace(/\s+/g, "") ?? ""
  if (!phone) {
    return { success: false, error: "phone is required for MTN MoMo", httpStatus: 400 }
  }

  const momoKey = (ctx.momoProviderKey ?? "mtn").toLowerCase()
  if (momoKey !== "mtn") {
    return {
      success: false,
      error: "MTN sandbox gateway supports MTN MoMo only; use Paystack for other networks.",
      httpStatus: 400,
    }
  }

  const reference = `FNZ-SUB-MTN-${randomUUID()}`
  const xReferenceId = randomUUID()
  const amountStr = ctx.amountGhs.toFixed(2)
  const msisdn = normalizeGhanaMsisdnForMtn(phone)
  const { error: txnInsErr } = await supabase.from("payment_provider_transactions").insert({
    business_id: ctx.businessId,
    provider_type: SUBSCRIPTION_PROVIDER_TYPE,
    workspace: SUBSCRIPTION_PLATFORM_WORKSPACE,
    invoice_id: null,
    sale_id: null,
    payment_id: null,
    reference,
    provider_transaction_id: xReferenceId,
    status: "initiated",
    amount_minor: ctx.amountPesewas,
    currency: "GHS",
    idempotency_key: reference,
    request_payload: {
      ...ctx.metadata,
      externalId: reference,
      xReferenceId,
      amount: amountStr,
    } as Record<string, unknown>,
    response_payload: null,
    last_event_payload: null,
    last_event_at: null,
  })

  if (txnInsErr) {
    console.error("[mtnMomoSandbox subscription] txn insert", txnInsErr)
    return { success: false, error: "Could not start payment session", httpStatus: 500 }
  }

  const tokenRes = await fetchMtnCollectionAccessToken(creds)
  if (!tokenRes.ok) {
    await supabase
      .from("payment_provider_transactions")
      .update({
        status: "failed",
        response_payload: { error: tokenRes.error } as Record<string, unknown>,
      })
      .eq("reference", reference)
      .eq("provider_type", SUBSCRIPTION_PROVIDER_TYPE)
      .eq("workspace", SUBSCRIPTION_PLATFORM_WORKSPACE)
    return { success: false, error: "Could not authenticate with MTN (check sandbox API credentials)", httpStatus: 502 }
  }

  const rtp = await requestToPayCollection({
    creds,
    accessToken: tokenRes.accessToken,
    xReferenceId,
    amount: amountStr,
    currency: "GHS",
    externalId: reference,
    payerMsisdn: msisdn,
    payerMessage: `Finza subscription (${ctx.tier})`,
    payeeNote: "Finza",
  })

  if (!rtp.ok || !rtp.accepted) {
    await supabase
      .from("payment_provider_transactions")
      .update({
        status: "failed",
        response_payload: { error: rtp.ok ? null : rtp.error, detail: rtp.ok ? null : rtp.detail } as Record<
          string,
          unknown
        >,
      })
      .eq("reference", reference)
      .eq("provider_type", SUBSCRIPTION_PROVIDER_TYPE)
      .eq("workspace", SUBSCRIPTION_PLATFORM_WORKSPACE)
    return {
      success: false,
      error: rtp.ok ? "MTN did not accept the payment request" : rtp.error,
      httpStatus: 502,
    }
  }

  await supabase
    .from("payment_provider_transactions")
    .update({
      status: "pending",
      response_payload: { httpStatus: 202, accepted: true } as Record<string, unknown>,
    })
    .eq("reference", reference)
    .eq("provider_type", SUBSCRIPTION_PROVIDER_TYPE)
    .eq("workspace", SUBSCRIPTION_PLATFORM_WORKSPACE)

  return {
    success: true,
    channel: "momo",
    reference,
    status: "pay_offline",
    otp_required: false,
    display_text: "Approve the MoMo prompt on your phone. We will confirm when MTN reports success.",
  }
}

export type MtnSandboxVerifyResult =
  | {
      success: true
      status: "success" | "pending" | "failed" | "abandoned"
      message?: string
      applied?: boolean
    }
  | { success: false; error: string; httpStatus: number }

/**
 * Authoritative: MTN GET request-to-pay status, then same subscription apply path as Paystack webhook.
 */
export async function mtnMomoSandboxVerifyAndApplySubscription(
  supabase: SupabaseClient,
  reference: string,
  options?: { businessIdMustMatch?: string }
): Promise<MtnSandboxVerifyResult> {
  const creds = platformMtnSandboxCredsFromEnv()
  if (!creds) {
    return { success: false, error: "MTN MoMo subscription gateway is not configured", httpStatus: 503 }
  }

  const ref = reference.trim()
  if (!ref) {
    return { success: false, error: "reference is required", httpStatus: 400 }
  }

  const { data: txn, error: txnErr } = await supabase
    .from("payment_provider_transactions")
    .select("id, business_id, provider_transaction_id, status, amount_minor, request_payload")
    .eq("provider_type", SUBSCRIPTION_PROVIDER_TYPE)
    .eq("workspace", SUBSCRIPTION_PLATFORM_WORKSPACE)
    .eq("reference", ref)
    .maybeSingle()

  if (txnErr || !txn) {
    return { success: false, error: "Payment session not found", httpStatus: 404 }
  }

  if (options?.businessIdMustMatch && txn.business_id !== options.businessIdMustMatch) {
    return { success: false, error: "Forbidden", httpStatus: 403 }
  }

  const payload = (txn.request_payload ?? {}) as Record<string, unknown>
  const metadata: Record<string, unknown> = {
    [FINZA_PAYSTACK_METADATA_PURPOSE_KEY]: payload[FINZA_PAYSTACK_METADATA_PURPOSE_KEY],
    business_id: payload.business_id,
    target_tier: payload.target_tier,
    billing_cycle: payload.billing_cycle,
    user_id: payload.user_id,
  }

  const amountGhs = Number(txn.amount_minor ?? 0) / 100

  if (txn.status === "successful") {
    return { success: true, status: "success", message: "Already confirmed" }
  }
  if (txn.status === "failed" || txn.status === "cancelled") {
    return { success: true, status: "failed" }
  }

  const xRef = txn.provider_transaction_id
  if (!xRef) {
    return { success: false, error: "Incomplete payment session", httpStatus: 400 }
  }

  const tokenRes = await fetchMtnCollectionAccessToken(creds)
  if (!tokenRes.ok) {
    return { success: true, status: "pending", message: "Could not reach MTN to verify" }
  }

  const st = await getRequestToPayStatus({
    creds,
    accessToken: tokenRes.accessToken,
    xReferenceId: xRef,
  })

  if (!st.ok) {
    return { success: true, status: "pending", message: "MTN status temporarily unavailable" }
  }

  const s = st.status.toUpperCase()
  if (s === "FAILED" || s === "REJECTED") {
    await supabase
      .from("payment_provider_transactions")
      .update({
        status: "failed",
        last_event_payload: { mtnStatus: st } as Record<string, unknown>,
        last_event_at: new Date().toISOString(),
      })
      .eq("id", txn.id)
      .in("status", [...OPEN_TXN_STATUSES])

    await applyPaystackSubscriptionWebhook({
      reference: ref,
      status: "failed",
      amountGhs,
      transactionId: st.financialTransactionId,
      metadata,
    })

    return { success: true, status: "failed" }
  }

  if (s !== "SUCCESSFUL") {
    return { success: true, status: "pending" }
  }

  const { data: promoted, error: promoteErr } = await supabase
    .from("payment_provider_transactions")
    .update({
      status: "successful",
      last_event_payload: { mtnStatus: st } as Record<string, unknown>,
      last_event_at: new Date().toISOString(),
    })
    .eq("id", txn.id)
    .in("status", [...OPEN_TXN_STATUSES])
    .select("id")
    .maybeSingle()

  if (promoteErr) {
    console.error("[mtnMomoSandbox subscription] promote", promoteErr)
    return { success: false, error: "Update failed", httpStatus: 500 }
  }

  if (!promoted) {
    const { data: cur } = await supabase
      .from("payment_provider_transactions")
      .select("status")
      .eq("id", txn.id)
      .maybeSingle()
    if ((cur as { status?: string } | null)?.status !== "successful") {
      return { success: true, status: "pending", message: "Could not finalize status" }
    }
  }

  const appliedOnce = !!promoted

  const sub = await applyPaystackSubscriptionWebhook({
    reference: ref,
    status: "success",
    amountGhs,
    transactionId: st.financialTransactionId,
    metadata,
  })

  return {
    success: true,
    status: "success",
    applied: appliedOnce && (sub.applied ?? false),
    message: sub.message,
  }
}
