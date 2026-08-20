import {
  resolveActiveFirmFromMemberships,
  type FirmMembershipOption,
} from "@/lib/accounting/firm/resolveActiveFirm"

const one: FirmMembershipOption = {
  firm_id: "firm-a",
  firm_name: "Alpha Firm",
  role: "partner",
}
const two: FirmMembershipOption = {
  firm_id: "firm-b",
  firm_name: "Beta Firm",
  role: "senior",
}

describe("resolveActiveFirmFromMemberships", () => {
  it("returns no membership when empty", () => {
    const r = resolveActiveFirmFromMemberships({ firms: [], storedFirmId: null })
    expect(r.firmId).toBeNull()
    expect(r.reason).toBe("no_membership")
    expect(r.requiresSelection).toBe(false)
  })

  it("clears stored firm when memberships empty", () => {
    const r = resolveActiveFirmFromMemberships({
      firms: [],
      storedFirmId: "stale",
    })
    expect(r.shouldPersist).toBe(true)
    expect(r.firmId).toBeNull()
  })

  it("auto-selects the only firm when storage empty", () => {
    const r = resolveActiveFirmFromMemberships({
      firms: [one],
      storedFirmId: null,
    })
    expect(r.firmId).toBe("firm-a")
    expect(r.firmName).toBe("Alpha Firm")
    expect(r.role).toBe("partner")
    expect(r.shouldPersist).toBe(true)
    expect(r.reason).toBe("single_auto")
  })

  it("preserves valid single-firm storage", () => {
    const r = resolveActiveFirmFromMemberships({
      firms: [one],
      storedFirmId: "firm-a",
    })
    expect(r.firmId).toBe("firm-a")
    expect(r.shouldPersist).toBe(false)
    expect(r.reason).toBe("single_preserved")
  })

  it("replaces invalid stored firm when exactly one membership remains", () => {
    const r = resolveActiveFirmFromMemberships({
      firms: [one],
      storedFirmId: "firm-x",
    })
    expect(r.firmId).toBe("firm-a")
    expect(r.shouldPersist).toBe(true)
    expect(r.reason).toBe("single_replaced_invalid")
  })

  it("preserves valid multi-firm stored selection", () => {
    const r = resolveActiveFirmFromMemberships({
      firms: [one, two],
      storedFirmId: "firm-b",
    })
    expect(r.firmId).toBe("firm-b")
    expect(r.firmName).toBe("Beta Firm")
    expect(r.role).toBe("senior")
    expect(r.requiresSelection).toBe(false)
    expect(r.shouldPersist).toBe(false)
    expect(r.reason).toBe("stored_valid")
  })

  it("does not randomly choose when multi-firm and storage missing", () => {
    const r = resolveActiveFirmFromMemberships({
      firms: [one, two],
      storedFirmId: null,
    })
    expect(r.firmId).toBeNull()
    expect(r.requiresSelection).toBe(true)
    expect(r.shouldPersist).toBe(false)
    expect(r.reason).toBe("multi_needs_selection")
  })

  it("clears forged/invalid cached firm for multi-firm users", () => {
    const r = resolveActiveFirmFromMemberships({
      firms: [one, two],
      storedFirmId: "forged-firm",
    })
    expect(r.firmId).toBeNull()
    expect(r.requiresSelection).toBe(true)
    expect(r.shouldPersist).toBe(true)
    expect(r.reason).toBe("stored_invalid_cleared")
  })

  it("covers invited staff: one membership + empty storage → auto-select", () => {
    const r = resolveActiveFirmFromMemberships({
      firms: [{ firm_id: "firm-invite", firm_name: "Invite Firm", role: "senior" }],
      storedFirmId: null,
    })
    expect(r.firmId).toBe("firm-invite")
    expect(r.role).toBe("senior")
    expect(r.reason).toBe("single_auto")
  })

  it("covers new partner after lost storage: restores single firm", () => {
    const r = resolveActiveFirmFromMemberships({
      firms: [{ firm_id: "new-firm", firm_name: "New Practice", role: "partner" }],
      storedFirmId: null,
    })
    expect(r.firmId).toBe("new-firm")
    expect(r.shouldPersist).toBe(true)
  })
})
