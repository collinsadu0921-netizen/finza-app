/**
 * Resolve stable client-supplied payroll payment idempotency keys.
 * Header is preferred; body field accepted for compatibility when both match.
 */
import { NextResponse } from "next/server"

const KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/

export type ResolvedPayrollIdempotencyKey =
  | { ok: true; key: string }
  | { ok: false; response: NextResponse }

export function resolvePayrollIdempotencyKey(
  request: { headers: { get(name: string): string | null } },
  body: Record<string, unknown> | null | undefined
): ResolvedPayrollIdempotencyKey {
  const headerKey = String(request.headers.get("Idempotency-Key") || "").trim()
  const bodyRaw = body?.idempotency_key ?? body?.idempotencyKey
  const bodyKey = bodyRaw != null ? String(bodyRaw).trim() : ""

  if (headerKey && bodyKey && headerKey !== bodyKey) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Idempotency-Key header and body idempotency_key must match when both are supplied",
          code: "PAYROLL_PAYMENT_IDEMPOTENCY_KEY_REQUIRED",
        },
        { status: 400 }
      ),
    }
  }

  const key = headerKey || bodyKey
  if (!key || !KEY_PATTERN.test(key)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "A stable Idempotency-Key header (16–128 chars) is required for payroll payments",
          code: "PAYROLL_PAYMENT_IDEMPOTENCY_KEY_REQUIRED",
        },
        { status: 400 }
      ),
    }
  }

  return { ok: true, key }
}
