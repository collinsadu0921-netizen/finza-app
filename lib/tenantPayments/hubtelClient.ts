import "server-only"

import {
  isHubtelStatusProxyEnvConfigured,
  logHubtelStatusCheck,
  redactHubtelStatusUrlForLog,
  sanitizeHubtelProxyUrlForLog,
} from "./hubtelStatusCheckLog"

export type HubtelCredentials = {
  apiId: string
  apiKey: string
  merchantAccountNumber: string
}

export type HubtelCheckoutInitiateParams = {
  credentials: HubtelCredentials
  totalAmount: number
  description: string
  callbackUrl: string
  returnUrl: string
  cancellationUrl: string
  clientReference: string
  payeeName?: string
  payeeMobileNumber?: string
  payeeEmail?: string
}

export type NormalizedHubtelCheckoutResponse = {
  responseCode: string | null
  status: string | null
  checkoutUrl: string | null
  checkoutId: string | null
  clientReference: string | null
  checkoutDirectUrl: string | null
  raw: Record<string, unknown>
}

export type NormalizedHubtelStatusResponse = {
  status: "Paid" | "Unpaid" | "Refunded" | "Unknown"
  grossAmount: number | null
  charges: number | null
  amountAfterCharges: number | null
  transactionId: string | null
  clientReference: string | null
  raw: Record<string, unknown>
}

export type HubtelHttpErrorKind =
  | "network"
  | "timeout"
  | "http_forbidden"
  | "http_error"
  | "malformed"

export class HubtelHttpError extends Error {
  readonly kind: HubtelHttpErrorKind
  readonly httpStatus: number | null

  constructor(message: string, kind: HubtelHttpErrorKind, httpStatus: number | null = null) {
    super(message)
    this.name = "HubtelHttpError"
    this.kind = kind
    this.httpStatus = httpStatus
  }
}

export function isHubtelStatusCheckUnavailableError(err: unknown): boolean {
  if (!(err instanceof HubtelHttpError)) return false
  return err.kind === "network" || err.kind === "timeout" || err.kind === "http_forbidden"
}

export function buildHubtelBasicAuthHeader(apiId: string, apiKey: string): string {
  const token = Buffer.from(`${apiId}:${apiKey}`, "utf8").toString("base64")
  return `Basic ${token}`
}

function hubtelInitiateUrl(): string {
  return (
    process.env.HUBTEL_CHECKOUT_INITIATE_URL?.trim() || "https://payproxyapi.hubtel.com/items/initiate"
  )
}

function hubtelStatusUrlTemplate(): string {
  return (
    process.env.HUBTEL_STATUS_CHECK_URL_TEMPLATE?.trim() ||
    "https://api-txnstatus.hubtel.com/transactions/{merchantAccountNumber}/status"
  )
}

function appendHubtelClientReferenceQuery(url: string, encodedRef: string): string {
  if (/clientReference=/i.test(url)) return url
  const querySep = url.includes("?") ? (url.endsWith("?") || url.endsWith("&") ? "" : "&") : "?"
  return `${url}${querySep}clientReference=${encodedRef}`
}

/** Build Hubtel Transaction Status Check URL (exported for tests). Uses clientReference only. */
export function buildHubtelStatusCheckUrl(merchantAccountNumber: string, clientReference: string): string {
  const encodedRef = encodeURIComponent(clientReference)
  const encodedMerchant = encodeURIComponent(merchantAccountNumber)
  let url = hubtelStatusUrlTemplate()
  if (url.includes("{merchantAccountNumber}")) {
    url = url.replace(/\{merchantAccountNumber\}/g, encodedMerchant)
  }
  if (url.includes("{clientReference}")) {
    return url.replace(/\{clientReference\}/g, encodedRef)
  }

  const pathWithoutQuery = url.split("?")[0].replace(/\/$/, "")
  const canonicalStatusPath = `/transactions/${encodedMerchant}/status`
  const alreadyHasMerchantStatusPath =
    pathWithoutQuery.endsWith(canonicalStatusPath) ||
    pathWithoutQuery.endsWith(`${canonicalStatusPath}/`) ||
    (url.includes(encodedMerchant) && /\/status(\/|\?|$)/i.test(url))

  if (alreadyHasMerchantStatusPath) {
    return appendHubtelClientReferenceQuery(url, encodedRef)
  }

  return appendHubtelClientReferenceQuery(`${pathWithoutQuery}/${encodedMerchant}/status`, encodedRef)
}

const DEFAULT_FETCH_MS = 25_000

async function hubtelFetch(
  url: string,
  init: RequestInit & { authHeader: string }
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null; text: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_FETCH_MS)
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: init.authHeader,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    })
    const text = await res.text()
    let json: Record<string, unknown> | null = null
    try {
      const parsed = text ? JSON.parse(text) : null
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        json = parsed as Record<string, unknown>
      }
    } catch {
      json = null
    }
    return { ok: res.ok, status: res.status, json, text }
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new HubtelHttpError("Hubtel request timed out", "timeout")
    }
    throw new HubtelHttpError("Hubtel request failed", "network")
  } finally {
    clearTimeout(timeout)
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function pickStr(obj: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!obj) return null
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return null
}

function pickNum(obj: Record<string, unknown> | null, ...keys: string[]): number | null {
  if (!obj) return null
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "number" && Number.isFinite(v)) return v
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v)
  }
  return null
}

export function normalizeHubtelCheckoutResponse(raw: Record<string, unknown>): NormalizedHubtelCheckoutResponse {
  const data = asRecord(raw.data) ?? asRecord(raw.Data) ?? raw
  return {
    responseCode: pickStr(raw, "responseCode", "ResponseCode"),
    status: pickStr(raw, "status", "Status"),
    checkoutUrl: pickStr(data, "checkoutUrl", "CheckoutUrl"),
    checkoutId: pickStr(data, "checkoutId", "CheckoutId"),
    clientReference: pickStr(data, "clientReference", "ClientReference"),
    checkoutDirectUrl: pickStr(data, "checkoutDirectUrl", "CheckoutDirectUrl"),
    raw,
  }
}

export function normalizeHubtelStatusResponse(raw: Record<string, unknown>): NormalizedHubtelStatusResponse {
  const data = asRecord(raw.data) ?? asRecord(raw.Data) ?? raw
  const statusRaw = pickStr(data, "status", "Status") ?? "Unknown"
  const statusNorm =
    statusRaw.toLowerCase() === "paid"
      ? "Paid"
      : statusRaw.toLowerCase() === "unpaid"
        ? "Unpaid"
        : statusRaw.toLowerCase() === "refunded"
          ? "Refunded"
          : "Unknown"

  return {
    status: statusNorm,
    grossAmount: pickNum(data, "amount", "Amount"),
    charges: pickNum(data, "charges", "Charges"),
    amountAfterCharges: pickNum(data, "amountAfterCharges", "AmountAfterCharges"),
    transactionId:
      pickStr(data, "transactionId", "TransactionId", "transaction_id") ??
      pickStr(data, "paymentId", "PaymentId"),
    clientReference: pickStr(data, "clientReference", "ClientReference"),
    raw,
  }
}

export async function createHubtelCheckout(
  params: HubtelCheckoutInitiateParams
): Promise<NormalizedHubtelCheckoutResponse> {
  const authHeader = buildHubtelBasicAuthHeader(params.credentials.apiId, params.credentials.apiKey)
  const body: Record<string, unknown> = {
    totalAmount: params.totalAmount,
    description: params.description,
    callbackUrl: params.callbackUrl,
    returnUrl: params.returnUrl,
    merchantAccountNumber: params.credentials.merchantAccountNumber,
    cancellationUrl: params.cancellationUrl,
    clientReference: params.clientReference,
  }
  if (params.payeeName) body.payeeName = params.payeeName
  if (params.payeeMobileNumber) body.payeeMobileNumber = params.payeeMobileNumber
  if (params.payeeEmail) body.payeeEmail = params.payeeEmail

  const res = await hubtelFetch(hubtelInitiateUrl(), {
    method: "POST",
    authHeader,
    body: JSON.stringify(body),
  })

  if (res.status === 403) {
    throw new HubtelHttpError("Hubtel checkout initiate forbidden", "http_forbidden", 403)
  }
  if (!res.ok || !res.json) {
    throw new HubtelHttpError(
      `Hubtel checkout initiate failed (${res.status})`,
      "http_error",
      res.status
    )
  }

  return normalizeHubtelCheckoutResponse(res.json)
}

export type HubtelStatusCheckContext = {
  paymentProviderTransactionId?: string
  providerTransactionId?: string | null
  checkoutId?: string | null
  workspace?: string
  invoiceId?: string | null
}

type HubtelStatusFetchResult = {
  ok: boolean
  status: number
  json: Record<string, unknown> | null
  text: string
}

export function hubtelStatusProxyConfigured(): boolean {
  return isHubtelStatusProxyEnvConfigured()
}

async function fetchHubtelStatusViaProxy(params: {
  credentials: HubtelCredentials
  clientReference: string
  context?: HubtelStatusCheckContext
}): Promise<HubtelStatusFetchResult> {
  const proxyUrl = process.env.HUBTEL_STATUS_PROXY_URL!.trim()
  const secret = process.env.HUBTEL_STATUS_PROXY_SECRET!.trim()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_FETCH_MS)

  try {
    const res = await fetch(proxyUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-finza-internal-secret": secret,
      },
      body: JSON.stringify({
        apiId: params.credentials.apiId,
        apiKey: params.credentials.apiKey,
        merchantAccountNumber: params.credentials.merchantAccountNumber,
        clientReference: params.clientReference,
        reference: params.clientReference,
        checkoutId: params.context?.checkoutId ?? params.context?.providerTransactionId ?? null,
        providerTransactionId: params.context?.providerTransactionId ?? null,
        paymentProviderTransactionId: params.context?.paymentProviderTransactionId ?? null,
        workspace: params.context?.workspace ?? null,
        invoiceId: params.context?.invoiceId ?? null,
      }),
      cache: "no-store",
    })
    const text = await res.text()
    let json: Record<string, unknown> | null = null
    try {
      const parsed = text ? JSON.parse(text) : null
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        json = parsed as Record<string, unknown>
      }
    } catch {
      json = null
    }
    return { ok: res.ok, status: res.status, json, text }
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new HubtelHttpError("Hubtel status proxy request timed out", "timeout")
    }
    throw new HubtelHttpError("Hubtel status proxy request failed", "network")
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchHubtelStatusDirect(params: {
  credentials: HubtelCredentials
  clientReference: string
}): Promise<HubtelStatusFetchResult> {
  const authHeader = buildHubtelBasicAuthHeader(params.credentials.apiId, params.credentials.apiKey)
  const url = buildHubtelStatusCheckUrl(params.credentials.merchantAccountNumber, params.clientReference)
  return hubtelFetch(url, { method: "GET", authHeader })
}

function interpretHubtelStatusFetchResult(res: HubtelStatusFetchResult): NormalizedHubtelStatusResponse {
  if (res.status === 403) {
    throw new HubtelHttpError("Hubtel status check forbidden (IP whitelist may be required)", "http_forbidden", 403)
  }
  if (!res.ok || !res.json) {
    throw new HubtelHttpError(`Hubtel status check failed (${res.status})`, "http_error", res.status)
  }
  return normalizeHubtelStatusResponse(res.json)
}

export async function checkHubtelTransactionStatus(params: {
  credentials: HubtelCredentials
  clientReference: string
  context?: HubtelStatusCheckContext
}): Promise<NormalizedHubtelStatusResponse> {
  const useProxy = hubtelStatusProxyConfigured()
  const proxyConfigured = useProxy
  const target = useProxy
    ? sanitizeHubtelProxyUrlForLog(process.env.HUBTEL_STATUS_PROXY_URL!.trim())
    : redactHubtelStatusUrlForLog(
        buildHubtelStatusCheckUrl(params.credentials.merchantAccountNumber, params.clientReference)
      )

  logHubtelStatusCheck({
    phase: "start",
    mode: useProxy ? "proxy" : "direct",
    target,
    clientReference: params.clientReference,
    merchantAccountNumber: params.credentials.merchantAccountNumber,
    checkoutId: params.context?.checkoutId ?? params.context?.providerTransactionId ?? null,
    paymentProviderTransactionId: params.context?.paymentProviderTransactionId ?? null,
    invoiceId: params.context?.invoiceId ?? null,
    proxyConfigured,
  })

  let res: HubtelStatusFetchResult
  try {
    res = useProxy ? await fetchHubtelStatusViaProxy(params) : await fetchHubtelStatusDirect(params)
  } catch (e: unknown) {
    const errorKind = e instanceof HubtelHttpError ? e.kind : undefined
    logHubtelStatusCheck({
      phase: "error",
      mode: useProxy ? "proxy" : "direct",
      target,
      clientReference: params.clientReference,
      merchantAccountNumber: params.credentials.merchantAccountNumber,
      checkoutId: params.context?.checkoutId ?? params.context?.providerTransactionId ?? null,
      paymentProviderTransactionId: params.context?.paymentProviderTransactionId ?? null,
      invoiceId: params.context?.invoiceId ?? null,
      httpStatus: e instanceof HubtelHttpError ? e.httpStatus : null,
      errorKind,
      proxyConfigured,
      verificationOutcome: "fetch_failed",
    })
    throw e
  }

  let normalized: NormalizedHubtelStatusResponse
  try {
    normalized = interpretHubtelStatusFetchResult(res)
  } catch (e: unknown) {
    const errorKind = e instanceof HubtelHttpError ? e.kind : undefined
    logHubtelStatusCheck({
      phase: "error",
      mode: useProxy ? "proxy" : "direct",
      target,
      clientReference: params.clientReference,
      merchantAccountNumber: params.credentials.merchantAccountNumber,
      checkoutId: params.context?.checkoutId ?? params.context?.providerTransactionId ?? null,
      paymentProviderTransactionId: params.context?.paymentProviderTransactionId ?? null,
      invoiceId: params.context?.invoiceId ?? null,
      httpStatus: res.status,
      errorKind,
      proxyConfigured,
      verificationOutcome: "interpret_failed",
    })
    throw e
  }

  logHubtelStatusCheck({
    phase: "response",
    mode: useProxy ? "proxy" : "direct",
    target,
    clientReference: params.clientReference,
    merchantAccountNumber: params.credentials.merchantAccountNumber,
    checkoutId: params.context?.checkoutId ?? params.context?.providerTransactionId ?? null,
    paymentProviderTransactionId: params.context?.paymentProviderTransactionId ?? null,
    invoiceId: params.context?.invoiceId ?? null,
    httpStatus: res.status,
    hubtelPaymentStatus: normalized.status,
    proxyConfigured,
    verificationOutcome: normalized.status,
  })

  return normalized
}

/** Compare monetary amounts with 2-decimal tolerance (major currency units). */
export function hubtelAmountsMatch(expected: number, actual: number, tolerance = 0.01): boolean {
  const exp = Math.round(expected * 100)
  const act = Math.round(actual * 100)
  return Math.abs(exp - act) <= Math.round(tolerance * 100)
}
