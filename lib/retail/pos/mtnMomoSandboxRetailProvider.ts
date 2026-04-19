import "server-only"

import { randomUUID } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { RetailMomoCartSnapshot } from "@/lib/retail/pos/retailMomoCartFingerprint"
import {
  fetchMtnCollectionAccessToken,
  getRequestToPayStatus,
  mtnCollectionRequestToPayCurrency,
  normalizeGhanaMsisdnForMtn,
  requestToPayCollection,
  type MtnMomoDirectTenantCredentials,
} from "@/lib/tenantPayments/providers/mtnMomoDirect"

const OPEN_TXN_STATUSES = ["initiated", "pending", "requires_action"] as const

/**
 * Retail POS MTN Collection sandbox — **env only** (does not use subscription or tenant-invoice keys).
 *
 * Preferred (Finza standard names):
 * - `MTN_MOMO_API_USER` — Collection API user UUID (Basic auth username)
 * - `MTN_MOMO_API_KEY` — API key secret from provisioning (Basic auth password only)
 * - `MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY` — Collections primary subscription key (portal) — `Ocp-Apim-Subscription-Key` on `/collection/token/` and RTP
 * - `MTN_MOMO_TARGET_ENVIRONMENT` — e.g. `sandbox` (X-Target-Environment)
 *
 * Optional legacy overrides (retail-only, same shape as above):
 * - `FINZA_MTN_RETAIL_POS_API_USER`, `FINZA_MTN_RETAIL_POS_API_KEY`, `FINZA_MTN_RETAIL_POS_PRIMARY_KEY`, `FINZA_MTN_RETAIL_POS_TARGET_ENVIRONMENT`
 *
 * Optional URL override (shared with tenant MTN direct): `MTN_MOMO_COLLECTION_BASE_URL`
 */
export type RetailMomoAppStatus =
  | "pending"
  | "successful"
  | "failed"
  | "cancelled"
  | "expired"
  | "provider_error"
  /** MTN returned a status string we do not map; DB row unchanged except `last_event_payload` audit fields. */
  | "provider_ambiguous"

export function retailMtnSandboxCredsFromEnv(): MtnMomoDirectTenantCredentials | null {
  const apiUser =
    process.env.MTN_MOMO_API_USER?.trim() || process.env.FINZA_MTN_RETAIL_POS_API_USER?.trim()
  const apiKey =
    process.env.MTN_MOMO_API_KEY?.trim() || process.env.FINZA_MTN_RETAIL_POS_API_KEY?.trim()
  const primarySubscriptionKey =
    process.env.MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY?.trim() ||
    process.env.FINZA_MTN_RETAIL_POS_PRIMARY_KEY?.trim()
  const targetEnvironmentRaw =
    process.env.MTN_MOMO_TARGET_ENVIRONMENT?.trim() ||
    process.env.FINZA_MTN_RETAIL_POS_TARGET_ENVIRONMENT?.trim() ||
    "sandbox"
  /** MTN expects lowercase for `sandbox`; country codes are lowercase in docs (e.g. mtnghana). */
  const targetEnvironment = targetEnvironmentRaw.toLowerCase()
  if (!apiUser || !apiKey || !primarySubscriptionKey) return null
  return { apiUser, apiKey, primarySubscriptionKey, targetEnvironment }
}

export function isRetailMtnSandboxConfigured(): boolean {
  return retailMtnSandboxCredsFromEnv() != null
}

export type ParsedMtnCollectionStatus =
  | { kind: "mapped"; app: "successful" | "failed" | "pending" }
  | { kind: "unknown"; raw: string }

export function parseMtnCollectionStatus(mtnStatusRaw: string): ParsedMtnCollectionStatus {
  const s = (mtnStatusRaw || "").toUpperCase()
  if (s === "SUCCESSFUL") return { kind: "mapped", app: "successful" }
  if (s === "FAILED" || s === "REJECTED") return { kind: "mapped", app: "failed" }
  if (s === "PENDING") return { kind: "mapped", app: "pending" }
  return { kind: "unknown", raw: s || "EMPTY" }
}

function isClientMarkedCancelledOrTimeout(last: unknown): boolean {
  const o = (last ?? {}) as Record<string, unknown>
  const m = o.clientMarked
  return m === "cancelled" || m === "timeout"
}

export type RetailMomoTxnRow = {
  id: string
  business_id: string
  reference: string
  provider_transaction_id: string | null
  status: string
  amount_minor: number | null
  request_payload: Record<string, unknown> | null
  last_event_payload?: Record<string, unknown> | null
  sale_id?: string | null
}

/**
 * Poll MTN and update `payment_provider_transactions` for workspace=retail.
 */
export async function refreshRetailMomoAttemptStatus(
  supabase: SupabaseClient,
  txn: RetailMomoTxnRow
): Promise<{ appStatus: RetailMomoAppStatus; providerStatus?: string; message?: string }> {
  const creds = retailMtnSandboxCredsFromEnv()
  if (!creds) {
    return { appStatus: "provider_error", message: "MTN retail sandbox is not configured" }
  }

  if (txn.status === "successful") {
    return { appStatus: "successful", message: "Already successful" }
  }
  if (txn.status === "failed") {
    return { appStatus: "failed" }
  }

  const allowMtnAfterClientCancel =
    txn.status === "cancelled" &&
    !txn.sale_id &&
    isClientMarkedCancelledOrTimeout(txn.last_event_payload ?? null)

  if (txn.status === "cancelled" && !allowMtnAfterClientCancel) {
    return { appStatus: "cancelled" }
  }

  const xRef = txn.provider_transaction_id
  if (!xRef) {
    return { appStatus: "provider_error", message: "Missing provider reference" }
  }

  const tokenRes = await fetchMtnCollectionAccessToken(creds)
  if (!tokenRes.ok) {
    console.warn("[retail-momo-sandbox] token failed", { reference: txn.reference })
    return { appStatus: "pending", message: "Could not reach MTN (token)" }
  }

  const st = await getRequestToPayStatus({
    creds,
    accessToken: tokenRes.accessToken,
    xReferenceId: xRef,
  })

  if (!st.ok) {
    console.warn("[retail-momo-sandbox] status HTTP", {
      reference: txn.reference,
      httpStatus: st.httpStatus,
    })
    return { appStatus: "pending", message: "MTN status temporarily unavailable" }
  }

  const providerStatus = st.status
  const parsed = parseMtnCollectionStatus(st.status)

  if (parsed.kind === "unknown") {
    await supabase
      .from("payment_provider_transactions")
      .update({
        last_event_payload: {
          mtnStatus: st,
          unrecognizedMtnStatus: parsed.raw,
        } as Record<string, unknown>,
        last_event_at: new Date().toISOString(),
      })
      .eq("id", txn.id)
    return {
      appStatus: "provider_ambiguous",
      providerStatus: parsed.raw,
      message: "Unrecognized MTN payment status — check MTN dashboard or retry",
    }
  }

  if (parsed.app === "failed") {
    await supabase
      .from("payment_provider_transactions")
      .update({
        status: "failed",
        last_event_payload: { mtnStatus: st } as Record<string, unknown>,
        last_event_at: new Date().toISOString(),
      })
      .eq("id", txn.id)
      .in(
        "status",
        allowMtnAfterClientCancel
          ? (["initiated", "pending", "requires_action", "cancelled"] as const)
          : [...OPEN_TXN_STATUSES],
      )
    return { appStatus: "failed", providerStatus }
  }

  if (parsed.app === "successful") {
    const { data: curRow } = await supabase
      .from("payment_provider_transactions")
      .select("status, last_event_payload, sale_id")
      .eq("id", txn.id)
      .maybeSingle()

    const cur = curRow as {
      status?: string
      last_event_payload?: Record<string, unknown> | null
      sale_id?: string | null
    } | null

    if (cur?.sale_id) {
      return { appStatus: "successful", providerStatus }
    }

    const stNow = cur?.status ?? txn.status
    const canFromOpen = stNow && (OPEN_TXN_STATUSES as readonly string[]).includes(stNow)
    const canFromClientCancelled =
      stNow === "cancelled" && isClientMarkedCancelledOrTimeout(cur?.last_event_payload ?? null)

    if (!canFromOpen && !canFromClientCancelled) {
      return {
        appStatus: "pending",
        providerStatus,
        message: "MTN reports success but local payment state cannot be promoted",
      }
    }

    let promoteQuery = supabase
      .from("payment_provider_transactions")
      .update({
        status: "successful",
        last_event_payload: {
          ...(cur?.last_event_payload ?? {}),
          mtnStatus: st,
          reconciled_from_client_cancel: canFromClientCancelled ? true : undefined,
        } as Record<string, unknown>,
        last_event_at: new Date().toISOString(),
      })
      .eq("id", txn.id)

    if (canFromClientCancelled) {
      promoteQuery = promoteQuery.eq("status", "cancelled")
    } else {
      promoteQuery = promoteQuery.in("status", [...OPEN_TXN_STATUSES])
    }

    const { data: promoted, error: promoteErr } = await promoteQuery.select("id").maybeSingle()

    if (promoteErr) {
      console.error("[retail-momo-sandbox] promote successful", promoteErr)
      return { appStatus: "provider_error", message: "Could not persist success" }
    }
    if (!promoted) {
      const { data: cur2 } = await supabase
        .from("payment_provider_transactions")
        .select("status")
        .eq("id", txn.id)
        .maybeSingle()
      if ((cur2 as { status?: string } | null)?.status === "successful") {
        return { appStatus: "successful", providerStatus }
      }
      return { appStatus: "pending", message: "Could not finalize provider status" }
    }
    return { appStatus: "successful", providerStatus }
  }

  if (allowMtnAfterClientCancel) {
    await supabase
      .from("payment_provider_transactions")
      .update({
        status: "pending",
        last_event_payload: { mtnStatus: st, reopened_after_client_cancel: true } as Record<string, unknown>,
        last_event_at: new Date().toISOString(),
      })
      .eq("id", txn.id)
      .eq("status", "cancelled")
  } else {
    await supabase
      .from("payment_provider_transactions")
      .update({
        status: "pending",
        last_event_payload: { mtnStatus: st } as Record<string, unknown>,
        last_event_at: new Date().toISOString(),
      })
      .eq("id", txn.id)
      .in("status", [...OPEN_TXN_STATUSES])
  }

  return { appStatus: "pending", providerStatus }
}

export async function sendRetailMomoRequestToPay(params: {
  supabase: SupabaseClient
  businessId: string
  amountGhs: number
  amountPesewas: number
  payerPhoneRaw: string
  storeId: string
  registerId: string
  cashierSessionId: string | null
  cartSnapshot: RetailMomoCartSnapshot
  serverCartFingerprint: string
  idempotencyKey: string
}): Promise<
  | { ok: true; reference: string }
  | { ok: false; error: string; httpStatus: number; reference?: string }
> {
  const creds = retailMtnSandboxCredsFromEnv()
  if (!creds) {
    return { ok: false, error: "MTN retail sandbox is not configured", httpStatus: 503 }
  }

  const phone = params.payerPhoneRaw.replace(/\s+/g, "")
  if (!phone) {
    return { ok: false, error: "phone is required", httpStatus: 400 }
  }

  const reference = `FNZ-RTL-MTN-${randomUUID()}`
  const xReferenceId = randomUUID()
  const amountStr = params.amountGhs.toFixed(2)
  const msisdn = normalizeGhanaMsisdnForMtn(phone)

  const { error: txnInsErr } = await params.supabase.from("payment_provider_transactions").insert({
    business_id: params.businessId,
    provider_type: "mtn_momo_direct",
    workspace: "retail",
    invoice_id: null,
    sale_id: null,
    payment_id: null,
    reference,
    provider_transaction_id: xReferenceId,
    status: "initiated",
    amount_minor: params.amountPesewas,
    currency: "GHS",
    idempotency_key: params.idempotencyKey,
    request_payload: {
      kind: "retail_pos_momo_sandbox",
      store_id: params.storeId,
      register_id: params.registerId,
      cashier_session_id: params.cashierSessionId,
      cart_snapshot: params.cartSnapshot as Record<string, unknown>,
      server_cart_fingerprint: params.serverCartFingerprint,
      externalId: reference,
      xReferenceId,
      amount: amountStr,
      /** last 4 only for logs / support */
      payer_hint: msisdn.slice(-4),
    } as Record<string, unknown>,
    response_payload: null,
    last_event_payload: null,
    last_event_at: null,
  })

  if (txnInsErr) {
    const code = (txnInsErr as { code?: string }).code
    if (code === "23505") {
      const { data: existing } = await params.supabase
        .from("payment_provider_transactions")
        .select("reference, status")
        .eq("business_id", params.businessId)
        .eq("idempotency_key", params.idempotencyKey)
        .maybeSingle()
      if (existing?.reference) {
        console.log("[retail-momo-sandbox] idempotent initiate reuse", {
          reference: existing.reference,
        })
        return { ok: true, reference: existing.reference }
      }
    }
    console.error("[retail-momo-sandbox] txn insert", txnInsErr)
    return { ok: false, error: "Could not start payment session", httpStatus: 500 }
  }

  const tokenRes = await fetchMtnCollectionAccessToken(creds)
  if (!tokenRes.ok) {
    await params.supabase
      .from("payment_provider_transactions")
      .update({
        status: "failed",
        response_payload: {
          error: tokenRes.error,
          httpStatus: tokenRes.httpStatus,
        } as Record<string, unknown>,
      })
      .eq("reference", reference)
      .eq("workspace", "retail")
    const detail = tokenRes.error
      ? ` ${String(tokenRes.error).replace(/\s+/g, " ").trim().slice(0, 280)}`
      : ""
    return {
      ok: false,
      error: `Could not authenticate with MTN (check sandbox API credentials).${detail ? ` MTN said:${detail}` : ""}`,
      httpStatus: 502,
      reference,
    }
  }

  const rtpCurrency = mtnCollectionRequestToPayCurrency(creds.targetEnvironment, "GHS")
  const rtp = await requestToPayCollection({
    creds,
    accessToken: tokenRes.accessToken,
    xReferenceId,
    amount: amountStr,
    currency: rtpCurrency,
    externalId: reference,
    payerMsisdn: msisdn,
    payerMessage: "Retail purchase",
    payeeNote: "Finza POS",
  })

  if (!rtp.ok || !rtp.accepted) {
    await params.supabase
      .from("payment_provider_transactions")
      .update({
        status: "failed",
        response_payload: {
          error: rtp.ok ? null : rtp.error,
          detail: rtp.ok ? null : rtp.detail,
          requestToPayCurrency: rtpCurrency,
        } as Record<string, unknown>,
      })
      .eq("reference", reference)
      .eq("workspace", "retail")
    return {
      ok: false,
      error: rtp.ok ? "MTN did not accept the payment request" : rtp.error,
      httpStatus: 502,
      reference,
    }
  }

  await params.supabase
    .from("payment_provider_transactions")
    .update({
      status: "pending",
      response_payload: { httpStatus: 202, accepted: true } as Record<string, unknown>,
    })
    .eq("reference", reference)
    .eq("workspace", "retail")

  console.log("[retail-momo-sandbox] request-to-pay sent", { reference, xReferenceId })
  return { ok: true, reference }
}
