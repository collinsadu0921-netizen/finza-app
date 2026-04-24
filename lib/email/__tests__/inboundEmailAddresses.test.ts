import { describe, it, expect } from "@jest/globals"
import { normalizeRecipientAddress, parseMailboxEmail } from "@/lib/email/inboundEmailAddresses"

describe("inboundEmailAddresses", () => {
  it("normalizes recipient to lowercase trimmed", () => {
    expect(normalizeRecipientAddress("  Docs+Tag@Example.COM ")).toBe("docs+tag@example.com")
    expect(normalizeRecipientAddress(null)).toBeNull()
  })

  it("parses mailbox from angle-addr form", () => {
    expect(parseMailboxEmail('Acme <onboarding@resend.dev>')).toBe("onboarding@resend.dev")
    expect(parseMailboxEmail("plain@example.com")).toBe("plain@example.com")
  })
})
