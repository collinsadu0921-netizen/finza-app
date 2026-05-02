import { interpretPaystackSubscriptionMomoChargeResponse } from "../paystackProvider"

const REF = "FNZ-SUB-testref"

describe("interpretPaystackSubscriptionMomoChargeResponse", () => {
  it("returns success for Charge attempted + pay_offline even when HTTP not OK and top-level status false", () => {
    const out = interpretPaystackSubscriptionMomoChargeResponse(
      {
        status: false,
        message: "Charge attempted",
        data: {
          status: "pay_offline",
          display_text: "Approve on your phone",
        },
      },
      false,
      REF
    )
    expect(out).toEqual({
      success: true,
      channel: "momo",
      reference: REF,
      status: "pay_offline",
      otp_required: false,
      display_text: "Approve on your phone",
      gateway_response: null,
    })
  })

  it("returns otp_required for send_otp", () => {
    const out = interpretPaystackSubscriptionMomoChargeResponse(
      {
        status: true,
        message: "Charge attempted",
        data: { status: "send_otp" },
      },
      true,
      REF
    )
    expect(out.success).toBe(true)
    if (out.success) {
      expect(out.otp_required).toBe(true)
      expect(out.status).toBe("send_otp")
    }
  })

  it("returns success for pending", () => {
    const out = interpretPaystackSubscriptionMomoChargeResponse(
      { status: true, message: "Charge attempted", data: { status: "pending" } },
      true,
      REF
    )
    expect(out.success).toBe(true)
    if (out.success) expect(out.status).toBe("pending")
  })

  it("returns success for success", () => {
    const out = interpretPaystackSubscriptionMomoChargeResponse(
      { status: true, message: "ok", data: { status: "success" } },
      true,
      REF
    )
    expect(out.success).toBe(true)
    if (out.success) expect(out.status).toBe("success")
  })

  it('failed + message "Charge attempted" + no gateway_response uses MoMo fallback (not Paystack message)', () => {
    const out = interpretPaystackSubscriptionMomoChargeResponse(
      {
        status: false,
        message: "Charge attempted",
        data: { status: "failed" },
      },
      false,
      REF
    )
    expect(out.success).toBe(false)
    if (!out.success) {
      expect(out.httpStatus).toBe(402)
      expect(out.error).toBe(
        "Mobile Money charge failed. Please check the number and try again."
      )
    }
  })

  it('failed + gateway_response uses gateway_response over "Charge attempted"', () => {
    const out = interpretPaystackSubscriptionMomoChargeResponse(
      {
        status: true,
        message: "Charge attempted",
        data: {
          status: "failed",
          gateway_response: "Unable to perform transaction, try again",
        },
      },
      true,
      REF
    )
    expect(out.success).toBe(false)
    if (!out.success) {
      expect(out.httpStatus).toBe(402)
      expect(out.error).toBe("Unable to perform transaction, try again")
    }
  })

  it("failed + distinct topMessage without gateway uses topMessage", () => {
    const out = interpretPaystackSubscriptionMomoChargeResponse(
      {
        status: false,
        message: "Insufficient funds",
        data: { status: "failed" },
      },
      false,
      REF
    )
    expect(out.success).toBe(false)
    if (!out.success) {
      expect(out.httpStatus).toBe(402)
      expect(out.error).toBe("Insufficient funds")
    }
  })

  it('error status behaves like failed for messaging', () => {
    const out = interpretPaystackSubscriptionMomoChargeResponse(
      {
        status: false,
        message: "Charge attempted",
        data: { status: "error" },
      },
      false,
      REF
    )
    expect(out.success).toBe(false)
    if (!out.success) {
      expect(out.httpStatus).toBe(402)
      expect(out.error).toBe(
        "Mobile Money charge failed. Please check the number and try again."
      )
    }
  })

  it("returns failure when data.status missing and HTTP/top-level indicate failure", () => {
    const out = interpretPaystackSubscriptionMomoChargeResponse(
      { status: false, message: "Invalid key" },
      false,
      REF
    )
    expect(out.success).toBe(false)
    if (!out.success) {
      expect(out.httpStatus).toBe(502)
      expect(out.error).toBe("Invalid key")
    }
  })

  it("returns failure when top-level ok but data.status unusable", () => {
    const out = interpretPaystackSubscriptionMomoChargeResponse(
      { status: true, message: "ok", data: { foo: "bar" } },
      true,
      REF
    )
    expect(out.success).toBe(false)
    if (!out.success) expect(out.httpStatus).toBe(502)
  })
})
