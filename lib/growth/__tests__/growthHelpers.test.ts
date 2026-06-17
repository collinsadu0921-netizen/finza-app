import { describe, it, expect } from "@jest/globals"
import { parsePhoneOrWhatsApp } from "@/lib/growth/parsePhoneOrWhatsApp"
import { buildWhatsAppFollowUpAction } from "@/lib/growth/whatsappFollowUp"

describe("parsePhoneOrWhatsApp", () => {
  it("accepts Ghana mobile with spaces", () => {
    const r = parsePhoneOrWhatsApp("024 123 4567")
    expect(r?.phone).toBe("024 123 4567")
    expect(r?.whatsapp_phone).toBe("024 123 4567")
  })

  it("rejects too-short input", () => {
    expect(parsePhoneOrWhatsApp("123")).toBeNull()
  })
})

describe("buildWhatsAppFollowUpAction", () => {
  it("builds wa.me link when phone present", () => {
    const action = buildWhatsAppFollowUpAction(
      {
        businessName: "Kofi Repairs",
        signupGoal: "send_invoices",
        trialStatus: "trialing",
        trialExpired: false,
        trialGraceActive: false,
        isLocked: false,
        activationState: "setup_only",
        events: new Set(),
      },
      "0241234567"
    )
    expect(action.suggested_message).toContain("Kofi Repairs")
    expect(action.whatsapp_url).toMatch(/^https:\/\/wa\.me\//)
  })
})
