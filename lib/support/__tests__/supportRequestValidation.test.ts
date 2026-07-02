import { validateSupportRequestInput } from "../supportRequestValidation"

describe("validateSupportRequestInput", () => {
  it("accepts valid payload", () => {
    const result = validateSupportRequestInput({
      category: "Invoices",
      subject: "Cannot send",
      message: "I tried to send invoice INV-001 but got an error.",
      urgency: "normal",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.category).toBe("Invoices")
      expect(result.data.urgency).toBe("normal")
    }
  })

  it("rejects empty short message", () => {
    const result = validateSupportRequestInput({
      category: "Invoices",
      message: "too short",
    })
    expect(result.ok).toBe(false)
  })

  it("rejects invalid category", () => {
    const result = validateSupportRequestInput({
      category: "Invalid",
      message: "This is a long enough message for support.",
    })
    expect(result.ok).toBe(false)
  })
})
