import "server-only"

/**
 * MTN MoMo Collection API (request-to-pay) — **tenant row credentials only**
 * (`business_payment_providers` via `mtnInvoiceDirectService`). No env fallback for api_user / keys.
 *
 * `MTN_MOMO_COLLECTION_BASE_URL` — optional **proxy base URL override** only (defaults to MTN Ghana collection).
 */

export type MtnMomoDirectTenantCredentials = {
  apiUser: string
  /** Used for Basic auth password segment and for Collection token `Ocp-Apim-Subscription-Key`. */
  apiKey: string
  /** Used for request-to-pay `Ocp-Apim-Subscription-Key` (primary / product subscription). */
  primarySubscriptionKey: string
  /** e.g. `mtnghana`, `sandbox` — sent as `X-Target-Environment`. */
  targetEnvironment: string
}

const DEFAULT_BASE = "https://proxy.momoapi.mtn.com"

export type MtnTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; error: string; httpStatus?: number }

export type MtnRequestToPayResult =
  | { ok: true; httpStatus: number; accepted: boolean }
  | { ok: false; error: string; httpStatus?: number; detail?: string }

export type MtnRequestToPayStatus =
  | { ok: true; status: string; financialTransactionId?: string; reason?: string }
  | { ok: false; error: string; httpStatus?: number }

function collectionBaseUrl(): string {
  return process.env.MTN_MOMO_COLLECTION_BASE_URL?.trim() || DEFAULT_BASE
}

export async function fetchMtnCollectionAccessToken(creds: MtnMomoDirectTenantCredentials): Promise<MtnTokenResult> {
  const basic = Buffer.from(`${creds.apiUser}:${creds.apiKey}`).toString("base64")
  const url = `${collectionBaseUrl()}/collection/token/`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Ocp-Apim-Subscription-Key": creds.apiKey,
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
  const url = `${collectionBaseUrl()}/collection/v1_0/requesttopay`
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
  return {
    ok: false,
    error: `MTN requestToPay failed (HTTP ${res.status})`,
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
  const url = `${collectionBaseUrl()}/collection/v1_0/requesttopay/${params.xReferenceId}`
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
