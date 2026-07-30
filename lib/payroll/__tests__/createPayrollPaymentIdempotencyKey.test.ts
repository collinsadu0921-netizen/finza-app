import {
  createPayrollPaymentIdempotencyKey,
  isValidPayrollPaymentIdempotencyKey,
} from "@/lib/payroll/createPayrollPaymentIdempotencyKey"

describe("createPayrollPaymentIdempotencyKey", () => {
  it("creates keys with payroll-payment prefix", () => {
    const key = createPayrollPaymentIdempotencyKey("payroll-payment")
    expect(key.startsWith("payroll-payment:")).toBe(true)
    expect(isValidPayrollPaymentIdempotencyKey(key)).toBe(true)
  })

  it("creates keys with payroll-batch-item prefix", () => {
    const key = createPayrollPaymentIdempotencyKey("payroll-batch-item")
    expect(key.startsWith("payroll-batch-item:")).toBe(true)
    expect(isValidPayrollPaymentIdempotencyKey(key)).toBe(true)
  })

  it("generates distinct keys per call", () => {
    const a = createPayrollPaymentIdempotencyKey("payroll-payment")
    const b = createPayrollPaymentIdempotencyKey("payroll-payment")
    expect(a).not.toBe(b)
  })
})
