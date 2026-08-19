import {
  evaluateEngagementState,
  isEngagementEffective,
  isEngagementStatusEffective,
} from "../evaluateEngagementState"

const now = new Date("2026-06-15T12:00:00.000Z")

describe("evaluateEngagementState / isEngagementEffective", () => {
  it("treats accepted + in-window as effective", () => {
    const engagement = {
      status: "accepted",
      effective_from: "2026-01-01",
      effective_to: null,
    }
    expect(isEngagementEffective(engagement, now)).toBe(true)
    expect(evaluateEngagementState({ engagement, now }).state).toBe("ACTIVE")
  })

  it("treats legacy active + in-window as effective", () => {
    expect(
      isEngagementEffective(
        { status: "active", effective_from: "2026-01-01", effective_to: null },
        now
      )
    ).toBe(true)
  })

  it("denies pending, suspended, and terminated", () => {
    const base = { effective_from: "2026-01-01", effective_to: null }
    expect(isEngagementEffective({ ...base, status: "pending" }, now)).toBe(false)
    expect(isEngagementEffective({ ...base, status: "suspended" }, now)).toBe(false)
    expect(isEngagementEffective({ ...base, status: "terminated" }, now)).toBe(false)
  })

  it("denies accepted engagements outside the date window", () => {
    expect(
      isEngagementEffective(
        { status: "accepted", effective_from: "2026-07-01", effective_to: null },
        now
      )
    ).toBe(false)
    expect(
      isEngagementEffective(
        { status: "accepted", effective_from: "2026-01-01", effective_to: "2026-05-01" },
        now
      )
    ).toBe(false)
  })

  it("isEngagementStatusEffective treats accepted and active as effective", () => {
    expect(isEngagementStatusEffective("accepted")).toBe(true)
    expect(isEngagementStatusEffective("active")).toBe(true)
    expect(isEngagementStatusEffective("pending")).toBe(false)
    expect(isEngagementStatusEffective("suspended")).toBe(false)
    expect(isEngagementStatusEffective(null)).toBe(true)
  })
})
