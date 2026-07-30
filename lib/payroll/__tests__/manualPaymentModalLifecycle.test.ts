import fs from "fs"
import path from "path"
import {
  submitManualSalaryPaymentRequest,
  tryCloseManualPaymentModal,
} from "@/lib/payroll/manualPaymentModalLifecycle"

function mockResponse(ok: boolean, body: Record<string, unknown>) {
  return {
    ok,
    json: async () => body,
  } as Response
}

describe("manualPaymentModalLifecycle", () => {
  it("returns success and supports reused", async () => {
    await expect(
      submitManualSalaryPaymentRequest({
        postPayment: async () => mockResponse(true, { reused: true }),
        parseJson: (res) => res.json(),
      })
    ).resolves.toEqual({ kind: "success", reused: true })
  })

  it("blocks user close while recording", () => {
    expect(tryCloseManualPaymentModal(true)).toBe("blocked")
    expect(tryCloseManualPaymentModal(false)).toBe("closed")
  })
})

describe("manual payment page success path", () => {
  const pageSource = fs.readFileSync(
    path.join(process.cwd(), "app/payroll/[id]/page.tsx"),
    "utf8"
  )

  it("closes modal directly on success without guarded close handler", () => {
    expect(pageSource).toContain("setShowPaymentModal(false)")
    expect(pageSource).toContain("salaryPaymentIdempotencyKeyRef.current = null")
    expect(pageSource).not.toMatch(/setShowPaymentModal\(false\)[\s\S]{0,120}if \(recordingPayment\) return/)
  })

  it("does not send batch_id in manual payment body", () => {
    expect(pageSource).not.toContain("batch_id: paymentForm.batch_id")
    expect(pageSource).not.toContain("handleSelectBatchForPayment")
  })

  it("uses resetBatchItemPaymentAfterSuccess instead of close on batch item success", () => {
    expect(pageSource).toContain("resetBatchItemPaymentAfterSuccess()")
    expect(pageSource).not.toContain("closeBatchItemPaymentModal(true)")
  })
})
