import "server-only"

export type HubtelStatusCheckLogEvent = {
  phase: "start" | "response" | "error"
  mode: "proxy" | "direct"
  /** Host + path only; never includes credentials or secrets */
  target: string
  clientReference: string
  merchantAccountNumber: string
  checkoutId?: string | null
  paymentProviderTransactionId?: string | null
  invoiceId?: string | null
  httpStatus?: number | null
  hubtelPaymentStatus?: string | null
  errorKind?: string
  proxyConfigured: boolean
  verificationOutcome?: string
}

export function isHubtelStatusProxyEnvConfigured(): boolean {
  const url = process.env.HUBTEL_STATUS_PROXY_URL?.trim()
  const secret = process.env.HUBTEL_STATUS_PROXY_SECRET?.trim()
  return Boolean(url && secret)
}

/** Log-safe URL: origin + pathname; clientReference value redacted. */
export function redactHubtelStatusUrlForLog(url: string): string {
  try {
    const u = new URL(url)
    const hasRef = u.searchParams.has("clientReference")
    u.searchParams.delete("clientReference")
    const qs = u.searchParams.toString()
    const refPart = hasRef
      ? `${qs ? `${qs}&` : ""}clientReference=<redacted>`
      : qs
    return `${u.origin}${u.pathname}${refPart ? `?${refPart}` : ""}`
  } catch {
    return url.replace(/clientReference=[^&]+/gi, "clientReference=<redacted>")
  }
}

export function sanitizeHubtelProxyUrlForLog(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return url.split("?")[0] ?? url
  }
}

export function logHubtelStatusCheck(event: HubtelStatusCheckLogEvent): void {
  console.info(JSON.stringify({ tag: "hubtel_status_check", ts: new Date().toISOString(), ...event }))
}

export function logHubtelVerifyOutcome(fields: {
  clientReference: string
  paymentProviderTransactionId?: string
  invoiceId?: string | null
  txnStatus?: string
  outcome: string
  applied?: boolean
  proxyConfigured: boolean
  message?: string
}): void {
  console.info(
    JSON.stringify({
      tag: "hubtel_invoice_verify",
      ts: new Date().toISOString(),
      ...fields,
    })
  )
}
