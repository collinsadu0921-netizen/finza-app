/**
 * Create a stable client idempotency key for payroll payment operations.
 * Keys are generated once per user action and reused for retries.
 */
export type PayrollPaymentIdempotencyScope = "payroll-payment" | "payroll-batch-item"

const KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/

function randomToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "")
  }
  const bytes = new Uint8Array(16)
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export function createPayrollPaymentIdempotencyKey(scope: PayrollPaymentIdempotencyScope): string {
  const token = randomToken()
  const key = `${scope}:${token}`
  if (!KEY_PATTERN.test(key)) {
    return `${scope}:${token.slice(0, 24)}`
  }
  return key
}

export function isValidPayrollPaymentIdempotencyKey(key: string): boolean {
  return KEY_PATTERN.test(key)
}
