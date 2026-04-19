import "server-only"

/**
 * MTN MoMo Collection API (request-to-pay) — **tenant row credentials only**
 * (`business_payment_providers` via `mtnInvoiceDirectService`). No env fallback for api_user / keys.
 *
 * `MTN_MOMO_COLLECTION_BASE_URL` — optional base URL override (any target).
 * When unset: `X-Target-Environment: sandbox` → `https://sandbox.momodeveloper.mtn.com` (portal keys match this gateway);
 * live country targets (e.g. `mtnghana`) → `https://proxy.momoapi.mtn.com`.
 */

export type MtnMomoDirectTenantCredentials = {
  apiUser: string
  /** Used only as the Basic auth password segment (`API_USER:API_KEY`); not the subscription key. */
  apiKey: string
  /** Collections primary subscription key — required on `/collection/token/` and RTP/status headers. */
  primarySubscriptionKey: string
  /** e.g. `mtnghana`, `sandbox` — sent as `X-Target-Environment`. */
  targetEnvironment: string
}

const PRODUCTION_COLLECTION_BASE = "https://proxy.momoapi.mtn.com"
/** Keys from https://momodeveloper.mtn.com only validate on this host — not on `proxy.momoapi.mtn.com`. */
const SANDBOX_COLLECTION_BASE = "https://sandbox.momodeveloper.mtn.com"

export type MtnTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; error: string; httpStatus?: number }

export type MtnRequestToPayResult =
  | { ok: true; httpStatus: number; accepted: boolean }
  | { ok: false; error: string; httpStatus?: number; detail?: string }

export type MtnRequestToPayStatus =
  | { ok: true; status: string; financialTransactionId?: string; reason?: string }
  | { ok: false; error: string; httpStatus?: number }

function collectionBaseUrl(targetEnvironment: string): string {
  const override = process.env.MTN_MOMO_COLLECTION_BASE_URL?.trim()
  if (override) return override
  const te = (targetEnvironment || "").trim().toLowerCase()
  if (te === "sandbox") return SANDBOX_COLLECTION_BASE
  return PRODUCTION_COLLECTION_BASE
}

/**
 * Request-to-pay `currency` field: MTN **sandbox** expects `EUR` (test wallets), not GHS/UGX/etc.
 * Live / country targets use the real settlement currency (e.g. GHS for Ghana).
 *
 * @see https://momodeveloper.mtn.com/api-documentation/testing/
 */
export function mtnCollectionRequestToPayCurrency(
  targetEnvironment: string,
  liveCurrency: string = "GHS",
): string {
  const te = (targetEnvironment || "").trim().toLowerCase()
  if (te === "sandbox") return "EUR"
  const c = (liveCurrency || "GHS").trim().toUpperCase()
  return /^[A-Z]{3}$/.test(c) ? c : "GHS"
}

export async function fetchMtnCollectionAccessToken(creds: MtnMomoDirectTenantCredentials): Promise<MtnTokenResult> {
  const basic = Buffer.from(`${creds.apiUser}:${creds.apiKey}`).toString("base64")
  const url = `${collectionBaseUrl(creds.targetEnvironment)}/collection/token/`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      /** MTN: same profile “Collections” primary key as request-to-pay — not the API Key secret. */
      "Ocp-Apim-Subscription-Key": creds.primarySubscriptionKey,
      "X-Target-Environment": creds.targetEnvironment,
    },
  })
  const text = await res.text()
  if (!res.ok) {
    return { ok: false, error: text || `MTN token HTTP ${res.status}`, httpStatus: res.status }
  }
  try {
    const data = JSON.parse(text) as { access_token?: string }
    if (!data.access_token) {
      return { ok: false, error: "MTN token response missing access_token", httpStatus: res.status }
    }
    return { ok: true, accessToken: data.access_token }
  } catch {
    return { ok: false, error: "MTN token response not JSON", httpStatus: res.status }
  }
}

/**
 * Initiate Collection request-to-pay. `xReferenceId` must be a fresh UUID per MTN rules.
 * `externalId` should be Finza’s stable `reference` stored in `payment_provider_transactions.reference`.
 */
export async function requestToPayCollection(params: {
  creds: MtnMomoDirectTenantCredentials
  accessToken: string
  xReferenceId: string
  amount: string
  currency: string
  externalId: string
  payerMsisdn: string
  payerMessage?: string
  payeeNote?: string
}): Promise<MtnRequestToPayResult> {
  const url = `${collectionBaseUrl(params.creds.targetEnvironment)}/collection/v1_0/requesttopay`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "X-Reference-Id": params.xReferenceId,
      "X-Target-Environment": params.creds.targetEnvironment,
      "Ocp-Apim-Subscription-Key": params.creds.primarySubscriptionKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: params.amount,
      currency: params.currency,
      externalId: params.externalId,
      payer: {
        partyIdType: "MSISDN",
        partyId: params.payerMsisdn,
      },
      payerMessage: params.payerMessage ?? "Invoice payment",
      payeeNote: params.payeeNote ?? "Finza",
    }),
  })

  if (res.status === 202) {
    return { ok: true, httpStatus: 202, accepted: true }
  }

  const text = await res.text()
  const snippet = text.replace(/\s+/g, " ").trim().slice(0, 400)
  return {
    ok: false,
    error: snippet
      ? `MTN requestToPay failed (HTTP ${res.status}): ${snippet}`
      : `MTN requestToPay failed (HTTP ${res.status})`,
    httpStatus: res.status,
    detail: text.slice(0, 500),
  }
}

/** GET requesttopay/{referenceId} where referenceId is the UUID sent as X-Reference-Id. */
export async function getRequestToPayStatus(params: {
  creds: MtnMomoDirectTenantCredentials
  accessToken: string
  xReferenceId: string
}): Promise<MtnRequestToPayStatus> {
  const url = `${collectionBaseUrl(params.creds.targetEnvironment)}/collection/v1_0/requesttopay/${params.xReferenceId}`
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "X-Target-Environment": params.creds.targetEnvironment,
      "Ocp-Apim-Subscription-Key": params.creds.primarySubscriptionKey,
    },
  })
  const text = await res.text()
  if (!res.ok) {
    return { ok: false, error: text || `MTN status HTTP ${res.status}`, httpStatus: res.status }
  }
  try {
    const data = JSON.parse(text) as {
      status?: string
      reason?: { message?: string }
      financialTransactionId?: string
    }
    return {
      ok: true,
      status: (data.status ?? "UNKNOWN").toUpperCase(),
      financialTransactionId: data.financialTransactionId,
      reason: data.reason?.message,
    }
  } catch {
    return { ok: false, error: "MTN status response not JSON", httpStatus: res.status }
  }
}

/** Normalize local phone to MSISDN without + (e.g. 233XXXXXXXXX). */
export function normalizeGhanaMsisdnForMtn(phone: string): string {
  let d = phone.replace(/\D/g, "")
  if (d.startsWith("0")) d = d.slice(1)
  if (!d.startsWith("233")) d = `233${d}`
  return d
}
