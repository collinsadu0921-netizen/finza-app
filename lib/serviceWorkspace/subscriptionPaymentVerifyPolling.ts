/**
 * Client-side Paystack subscription verify polling (card callback + MoMo success).
 * Calls GET /api/payments/subscription/verify — same idempotent path as webhooks.
 */

export type SubscriptionVerifyResponse = {
  status?: string
  activation_applied?: boolean
  activation_error?: string
  activation_message?: string
  message?: string
}

export type SubscriptionVerifyToastType = "success" | "error" | "info"

export type SubscriptionVerifyPollOutcome =
  | { kind: "activated"; toastType: SubscriptionVerifyToastType; message: string }
  | { kind: "payment_failed"; toastType: "error"; message: string }
  | { kind: "timeout"; toastType: "info"; message: string }

const DEFAULT_MAX_ATTEMPTS = 15
const DEFAULT_INTERVAL_MS = 1500

export function buildSubscriptionVerifyUrl(reference: string, businessId: string): string {
  return `/api/payments/subscription/verify?reference=${encodeURIComponent(reference)}&business_id=${encodeURIComponent(businessId)}`
}

/** Paystack MoMo / OTP terminal statuses that should confirm activation via verify. */
export function shouldConfirmPaystackSubscriptionViaVerify(effectiveStatus: string): boolean {
  return effectiveStatus.trim().toLowerCase() === "success"
}

export function interpretSubscriptionVerifySuccess(
  json: SubscriptionVerifyResponse,
  reference: string
): Omit<Extract<SubscriptionVerifyPollOutcome, { kind: "activated" }>, "kind"> {
  const applied = json.activation_applied === true
  const activationErr =
    typeof json.activation_error === "string" && json.activation_error.trim()
      ? json.activation_error.trim()
      : ""
  const activationMsg =
    typeof json.activation_message === "string" ? json.activation_message : ""
  const duplicateOrHandled =
    !applied &&
    !activationErr &&
    /duplicate success|idempotent|already succeeded/i.test(activationMsg)

  if (applied) {
    return {
      toastType: "success",
      message: "Payment confirmed. Your plan has been updated.",
    }
  }
  if (duplicateOrHandled) {
    return {
      toastType: "success",
      message: "Payment confirmed. Your plan is active.",
    }
  }
  if (activationErr || (!applied && activationMsg)) {
    return {
      toastType: "error",
      message: `Payment confirmed, but your plan could not be activated automatically. Contact support with reference: ${reference}`,
    }
  }
  return {
    toastType: "success",
    message:
      "Payment confirmed. Your plan will update shortly. Your billing period runs from this payment.",
  }
}

export async function pollSubscriptionPaymentVerify(params: {
  reference: string
  businessId: string
  fetchFn?: typeof fetch
  maxAttempts?: number
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
}): Promise<SubscriptionVerifyPollOutcome> {
  const fetchFn = params.fetchFn ?? fetch
  const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const intervalMs = params.intervalMs ?? DEFAULT_INTERVAL_MS
  const sleep =
    params.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  const url = buildSubscriptionVerifyUrl(params.reference, params.businessId)

  for (let i = 0; i < maxAttempts; i++) {
    const r = await fetchFn(url, { cache: "no-store" })
    const j = (await r.json()) as SubscriptionVerifyResponse

    if (j.status === "success") {
      const interpreted = interpretSubscriptionVerifySuccess(j, params.reference)
      return { kind: "activated", ...interpreted }
    }
    if (j.status === "failed" || j.status === "abandoned") {
      return {
        kind: "payment_failed",
        toastType: "error",
        message: "Payment was not completed.",
      }
    }
    await sleep(intervalMs)
  }

  return {
    kind: "timeout",
    toastType: "info",
    message: "Still processing — refresh this page shortly.",
  }
}
