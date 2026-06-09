export type StatusCheckRequestBody = {
  apiId: string
  apiKey: string
  merchantAccountNumber: string
  clientReference: string
  reference?: string
  checkoutId?: string | null
  providerTransactionId?: string | null
  paymentProviderTransactionId?: string | null
  workspace?: string | null
  invoiceId?: string | null
}

export type StatusCheckValidation =
  | { ok: true; body: StatusCheckRequestBody }
  | { ok: false; error: string }

function statusUrlTemplate(): string {
  return (
    process.env.HUBTEL_STATUS_CHECK_URL_TEMPLATE?.trim() ||
    "https://api-txnstatus.hubtel.com/transactions/{merchantAccountNumber}/status"
  )
}

export function buildHubtelStatusCheckUrl(merchantAccountNumber: string, clientReference: string): string {
  const encodedRef = encodeURIComponent(clientReference)
  const encodedMerchant = encodeURIComponent(merchantAccountNumber)
  let url = statusUrlTemplate()
  if (url.includes("{merchantAccountNumber}")) {
    url = url.replace("{merchantAccountNumber}", encodedMerchant)
  }
  if (url.includes("{clientReference}")) {
    return url.replace("{clientReference}", encodedRef)
  }
  if (url.includes("clientReference=")) {
    return url
  }
  const querySep = url.includes("?") ? (url.endsWith("?") || url.endsWith("&") ? "" : "&") : "?"
  if (url.includes(encodedMerchant)) {
    return `${url}${querySep}clientReference=${encodedRef}`
  }
  const base = url.replace(/\/$/, "")
  return `${base}/${encodedMerchant}/status?clientReference=${encodedRef}`
}

function pickStr(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key]
  return typeof v === "string" && v.trim() ? v.trim() : null
}

export function validateStatusCheckBody(raw: unknown): StatusCheckValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Request body must be a JSON object" }
  }
  const obj = raw as Record<string, unknown>
  const apiId = pickStr(obj, "apiId")
  const apiKey = pickStr(obj, "apiKey")
  const merchantAccountNumber = pickStr(obj, "merchantAccountNumber")
  const clientReference =
    pickStr(obj, "clientReference") ?? pickStr(obj, "reference")

  if (!apiId) return { ok: false, error: "apiId is required" }
  if (!apiKey) return { ok: false, error: "apiKey is required" }
  if (!merchantAccountNumber) return { ok: false, error: "merchantAccountNumber is required" }
  if (!clientReference) return { ok: false, error: "clientReference is required" }

  return {
    ok: true,
    body: {
      apiId,
      apiKey,
      merchantAccountNumber,
      clientReference,
      reference: pickStr(obj, "reference") ?? clientReference,
      checkoutId: pickStr(obj, "checkoutId"),
      providerTransactionId: pickStr(obj, "providerTransactionId"),
      paymentProviderTransactionId: pickStr(obj, "paymentProviderTransactionId"),
      workspace: pickStr(obj, "workspace"),
      invoiceId: pickStr(obj, "invoiceId"),
    },
  }
}

export async function callHubtelTransactionStatus(
  body: StatusCheckRequestBody
): Promise<{ httpStatus: number; responseText: string }> {
  const url = buildHubtelStatusCheckUrl(body.merchantAccountNumber, body.clientReference)
  const token = Buffer.from(`${body.apiId}:${body.apiKey}`, "utf8").toString("base64")
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${token}`,
      },
    })
    const responseText = await res.text()
    return { httpStatus: res.status, responseText }
  } finally {
    clearTimeout(timeout)
  }
}

export function safeLogLine(fields: {
  clientReference: string
  checkoutId?: string | null
  httpStatus: number
  responseText: string
}): string {
  return JSON.stringify({
    ts: new Date().toISOString(),
    clientReference: fields.clientReference,
    checkoutId: fields.checkoutId ?? null,
    hubtelHttpStatus: fields.httpStatus,
    hubtelResponseBody: fields.responseText.slice(0, 4000),
  })
}
