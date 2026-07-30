import { resolvePayrollIdempotencyKey } from "@/lib/payroll/resolvePayrollIdempotencyKey"

describe("resolvePayrollIdempotencyKey", () => {
  const validKey = "client-stable-key-001"

  it("prefers Idempotency-Key header", () => {
    const result = resolvePayrollIdempotencyKey(
      { headers: { get: (n) => (n === "Idempotency-Key" ? validKey : null) } },
      {}
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.key).toBe(validKey)
  })

  it("accepts deprecated body field when header absent", () => {
    const result = resolvePayrollIdempotencyKey(
      { headers: { get: () => null } },
      { idempotency_key: validKey }
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.key).toBe(validKey)
  })

  it("rejects missing key", () => {
    const result = resolvePayrollIdempotencyKey({ headers: { get: () => null } }, {})
    expect(result.ok).toBe(false)
  })

  it("rejects header/body mismatch", () => {
    const result = resolvePayrollIdempotencyKey(
      { headers: { get: () => "header-key-1234567890" } },
      { idempotency_key: "body-key-1234567890" }
    )
    expect(result.ok).toBe(false)
  })

  it("rejects keys shorter than 16 chars", () => {
    const result = resolvePayrollIdempotencyKey(
      { headers: { get: () => "short" } },
      null
    )
    expect(result.ok).toBe(false)
  })
})
