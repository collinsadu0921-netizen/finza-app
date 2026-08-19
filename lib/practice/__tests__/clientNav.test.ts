import { PRACTICE_CLIENT_NAV_TABS, practiceClientNavHasNotesTab } from "../clientNav"

describe("practice client nav", () => {
  it("does not expose a dead Notes tab", () => {
    expect(practiceClientNavHasNotesTab()).toBe(false)
    expect(PRACTICE_CLIENT_NAV_TABS.some((tab) => tab.label === "Notes")).toBe(false)
  })

  it("keeps Overview where notes remain accessible", () => {
    expect(PRACTICE_CLIENT_NAV_TABS[0]?.segment).toBe("overview")
  })
})
