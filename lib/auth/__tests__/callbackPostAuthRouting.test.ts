import {
  resolveBusinessDashboardRedirect,
  shouldApplyServiceMarketingMetadataFromUrl,
  urlIndicatesServiceMarketingContext,
} from "../callbackPostAuthRouting"

describe("urlIndicatesServiceMarketingContext", () => {
  it("is true for workspace=service with trial=1", () => {
    expect(urlIndicatesServiceMarketingContext("service", "1", null)).toBe(true)
  })

  it("is true for workspace=service with valid plan", () => {
    expect(urlIndicatesServiceMarketingContext("service", null, "starter")).toBe(true)
  })

  it("is false without workspace=service", () => {
    expect(urlIndicatesServiceMarketingContext("retail", "1", "starter")).toBe(false)
  })

  it("is false for workspace=service with no plan and no trial", () => {
    expect(urlIndicatesServiceMarketingContext("service", null, null)).toBe(false)
  })
})

describe("shouldApplyServiceMarketingMetadataFromUrl", () => {
  it("applies when plan parses and intent is not accounting_firm", () => {
    expect(shouldApplyServiceMarketingMetadataFromUrl("professional", undefined)).toBe(true)
    expect(shouldApplyServiceMarketingMetadataFromUrl("starter", "business_owner")).toBe(true)
  })

  it("never applies for accounting_firm", () => {
    expect(shouldApplyServiceMarketingMetadataFromUrl("starter", "accounting_firm")).toBe(false)
  })

  it("does not apply when plan is null", () => {
    expect(shouldApplyServiceMarketingMetadataFromUrl(null, "business_owner")).toBe(false)
  })
})

describe("resolveBusinessDashboardRedirect", () => {
  it("single retail -> /retail/dashboard", () => {
    expect(resolveBusinessDashboardRedirect([{ id: "1", industry: "retail" }], false)).toBe(
      "/retail/dashboard"
    )
  })

  it("single service -> /service/dashboard", () => {
    expect(resolveBusinessDashboardRedirect([{ id: "1", industry: "service" }], false)).toBe(
      "/service/dashboard"
    )
  })

  it("single logistics -> /", () => {
    expect(resolveBusinessDashboardRedirect([{ id: "1", industry: "logistics" }], false)).toBe("/")
  })

  it("multi-owner: prefers service dashboard when URL indicates service marketing", () => {
    expect(
      resolveBusinessDashboardRedirect(
        [
          { id: "1", industry: "retail" },
          { id: "2", industry: "service" },
        ],
        true
      )
    ).toBe("/service/dashboard")
  })

  it("multi-owner: goes to / when URL does not prefer service", () => {
    expect(
      resolveBusinessDashboardRedirect(
        [
          { id: "1", industry: "retail" },
          { id: "2", industry: "service" },
        ],
        false
      )
    ).toBe("/")
  })

  it("multi-owner: url prefers service but no service business -> /", () => {
    expect(
      resolveBusinessDashboardRedirect(
        [
          { id: "1", industry: "retail" },
          { id: "2", industry: "retail" },
        ],
        true
      )
    ).toBe("/")
  })

  it("throws when businesses array is empty", () => {
    expect(() => resolveBusinessDashboardRedirect([], false)).toThrow()
  })
})
