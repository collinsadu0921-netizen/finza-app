import {
  getRequiredPermissionForPath,
  normalizePathForPermission,
} from "../routePermissionRules"

describe("routePermissionRules", () => {
  it("normalizes query and trailing slash", () => {
    expect(normalizePathForPermission("/service/invoices?business_id=x")).toBe("/service/invoices")
    expect(normalizePathForPermission("/service/invoices/")).toBe("/service/invoices")
  })

  it("uses most specific prefix: trial balance is accounting not reports", () => {
    expect(getRequiredPermissionForPath("/service/reports/trial-balance")).toBe("accounting.view")
    expect(getRequiredPermissionForPath("/service/reports/profit-and-loss")).toBe("reports.view")
  })

  it("service bills require bills.view not generic bills", () => {
    expect(getRequiredPermissionForPath("/service/bills")).toBe("bills.view")
  })

  it("dashboard has no extra permission gate", () => {
    expect(getRequiredPermissionForPath("/service/dashboard")).toBeNull()
  })

  it("settings team before settings catch-all", () => {
    expect(getRequiredPermissionForPath("/service/settings/team")).toBe("team.manage")
    expect(getRequiredPermissionForPath("/service/settings/subscription")).toBe("settings.view")
  })

  it("retail ledger reports require reports.view", () => {
    expect(getRequiredPermissionForPath("/retail/reports/profit-and-loss")).toBe("reports.view")
    expect(getRequiredPermissionForPath("/retail/reports/balance-sheet")).toBe("reports.view")
  })
})
