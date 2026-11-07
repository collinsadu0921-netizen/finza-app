import { createHmac } from "crypto"
import {
  extractPaystackTransferFeePesewas,
  initiatePaystackBulkTransfer,
  isPaystackPayrollMockMode,
  normalizePaystackTransferStatus,
  verifyPaystackWebhookSignature,
} from "@/lib/payroll/paystack/paystackClient"

describe("Paystack client safeguards", () => {
  const secret = "sk_test_unit_test_secret"
  const raw = JSON.stringify({ event: "transfer.success", data: { reference: "ref-1" } })

  it("verifies the HMAC-SHA512 signature over the exact raw body", () => {
    const signature = createHmac("sha512", secret).update(raw, "utf8").digest("hex")
    expect(verifyPaystackWebhookSignature(raw, signature, secret)).toBe(true)
  })

  it("rejects a different body, secret or missing signature", () => {
    const signature = createHmac("sha512", secret).update(raw, "utf8").digest("hex")
    expect(verifyPaystackWebhookSignature(raw + " ", signature, secret)).toBe(false)
    expect(verifyPaystackWebhookSignature(raw, signature, "sk_test_other")).toBe(false)
    expect(verifyPaystackWebhookSignature(raw, null, secret)).toBe(false)
  })

  it("normalizes provider statuses without assuming success", () => {
    expect(normalizePaystackTransferStatus("success")).toBe("successful")
    expect(normalizePaystackTransferStatus("otp")).toBe("awaiting_authorization")
    expect(normalizePaystackTransferStatus("pending")).toBe("pending")
    expect(normalizePaystackTransferStatus("failed")).toBe("failed")
    expect(normalizePaystackTransferStatus("reversed")).toBe("reversed")
    expect(normalizePaystackTransferStatus("something-new")).toBe("requires_attention")
  })

  it("never enables the staging mock in production", () => {
    expect(
      isPaystackPayrollMockMode({
        PAYSTACK_PAYROLL_MOCK_MODE: "true",
        VERCEL_ENV: "production",
      } as NodeJS.ProcessEnv)
    ).toBe(false)
    expect(
      isPaystackPayrollMockMode({
        PAYSTACK_PAYROLL_MOCK_MODE: "true",
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv)
    ).toBe(false)
    expect(
      isPaystackPayrollMockMode({
        PAYSTACK_PAYROLL_MOCK_MODE: "true",
        VERCEL_ENV: "preview",
      } as NodeJS.ProcessEnv)
    ).toBe(true)
    expect(
      isPaystackPayrollMockMode({
        PAYSTACK_PAYROLL_MOCK_MODE: "false",
        VERCEL_ENV: "preview",
      } as NodeJS.ProcessEnv)
    ).toBe(false)
  })

  it("reads provider fees only when they are reported", () => {
    expect(extractPaystackTransferFeePesewas({ fee: 150 })).toBe(150)
    expect(extractPaystackTransferFeePesewas({ fees_breakdown: [{ amount: 100 }, { amount: 50 }] })).toBe(150)
    expect(extractPaystackTransferFeePesewas({})).toBeNull()
  })

  it("submits a genuine bulk request in staging mock mode", async () => {
    const previousMode = process.env.PAYSTACK_PAYROLL_MOCK_MODE
    const previousEnv = process.env.VERCEL_ENV
    process.env.PAYSTACK_PAYROLL_MOCK_MODE = "true"
    process.env.VERCEL_ENV = "preview"
    try {
      const result = await initiatePaystackBulkTransfer("sk_test_bulk", {
        source: "balance",
        currency: "GHS",
        transfers: [
          { amount: 1000, recipient: "RCP_one", reason: "Salary", reference: "bulk-ref-one" },
          { amount: 2000, recipient: "RCP_two", reason: "Salary", reference: "bulk-ref-two" },
        ],
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toHaveLength(2)
        expect(result.data.map((row) => row.reference)).toEqual(["bulk-ref-one", "bulk-ref-two"])
        expect(result.data.every((row) => row.status === "success")).toBe(true)
      }
    } finally {
      if (previousMode === undefined) delete process.env.PAYSTACK_PAYROLL_MOCK_MODE
      else process.env.PAYSTACK_PAYROLL_MOCK_MODE = previousMode
      if (previousEnv === undefined) delete process.env.VERCEL_ENV
      else process.env.VERCEL_ENV = previousEnv
    }
  })
})
