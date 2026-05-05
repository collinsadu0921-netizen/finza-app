import {
  AUTH_CALLBACK_MEMBERSHIP_QUERY_LIMIT,
  isMembershipResultPotentiallyTruncated,
  mergeAccessibleBusinesses,
  resolveMembershipQueryFailureRedirect,
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

  it("multi-access: routes to /select-workspace", () => {
    expect(
      resolveBusinessDashboardRedirect(
        [
          { id: "1", industry: "retail" },
          { id: "2", industry: "service" },
        ],
        true
      )
    ).toBe("/select-workspace")
  })

  it("multi-access: routes to /select-workspace when URL does not prefer service", () => {
    expect(
      resolveBusinessDashboardRedirect(
        [
          { id: "1", industry: "retail" },
          { id: "2", industry: "service" },
        ],
        false
      )
    ).toBe("/select-workspace")
  })

  it("multi-access: service marketing params do not force /service/dashboard", () => {
    expect(
      resolveBusinessDashboardRedirect(
        [
          { id: "1", industry: "retail" },
          { id: "2", industry: "retail" },
        ],
        true
      )
    ).toBe("/select-workspace")
  })

  it("throws when businesses array is empty", () => {
    expect(() => resolveBusinessDashboardRedirect([], false)).toThrow()
  })
})

describe("mergeAccessibleBusinesses", () => {
  it("one owned service business -> service dashboard input", () => {
    const merged = mergeAccessibleBusinesses([{ id: "o1", industry: "service" }], [])
    expect(resolveBusinessDashboardRedirect(merged, false)).toBe("/service/dashboard")
  })

  it("one owned retail business -> retail dashboard input", () => {
    const merged = mergeAccessibleBusinesses([{ id: "o1", industry: "retail" }], [])
    expect(resolveBusinessDashboardRedirect(merged, false)).toBe("/retail/dashboard")
  })

  it("one owned + one member business -> select workspace", () => {
    const merged = mergeAccessibleBusinesses(
      [{ id: "o1", industry: "service" }],
      [{ business_id: "m1", businesses: { id: "m1", industry: "retail", archived_at: null } }]
    )
    expect(resolveBusinessDashboardRedirect(merged, false)).toBe("/select-workspace")
  })

  it("member-only access to two businesses -> select workspace", () => {
    const merged = mergeAccessibleBusinesses([], [
      { business_id: "m1", businesses: { id: "m1", industry: "service", archived_at: null } },
      { business_id: "m2", businesses: { id: "m2", industry: "retail", archived_at: null } },
    ])
    expect(resolveBusinessDashboardRedirect(merged, false)).toBe("/select-workspace")
  })

  it("ignores archived membership businesses and de-duplicates by id", () => {
    const merged = mergeAccessibleBusinesses(
      [{ id: "same", industry: "service" }],
      [
        { business_id: "same", businesses: { id: "same", industry: "retail", archived_at: null } },
        { business_id: "arch", businesses: { id: "arch", industry: "retail", archived_at: "2026-01-01" } },
      ]
    )
    expect(merged).toEqual([{ id: "same", industry: "service" }])
  })

  it("no businesses -> onboarding branch remains available to callback", () => {
    const merged = mergeAccessibleBusinesses([], [])
    expect(merged).toEqual([])
  })
})

describe("callback hardening helpers", () => {
  it("membership query failure with one owned business -> /select-workspace (safe)", () => {
    expect(resolveMembershipQueryFailureRedirect(1)).toBe("/select-workspace")
  })

  it("membership query failure does not allow marketing-preferring direct service redirect", () => {
    expect(resolveMembershipQueryFailureRedirect(1)).not.toBe("/service/dashboard")
    expect(resolveMembershipQueryFailureRedirect(2)).toBe("/select-workspace")
  })

  it("membership truncation is intentional at limit and over limit", () => {
    expect(isMembershipResultPotentiallyTruncated(AUTH_CALLBACK_MEMBERSHIP_QUERY_LIMIT)).toBe(true)
    expect(isMembershipResultPotentiallyTruncated(AUTH_CALLBACK_MEMBERSHIP_QUERY_LIMIT + 1)).toBe(true)
    expect(isMembershipResultPotentiallyTruncated(AUTH_CALLBACK_MEMBERSHIP_QUERY_LIMIT - 1)).toBe(false)
  })
})
