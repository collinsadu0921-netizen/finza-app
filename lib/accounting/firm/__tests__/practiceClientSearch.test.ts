import {
  isEligiblePracticeClientIndustry,
  isPracticeClientCreateRoles,
  shouldClearPracticeClientSelection,
  shouldRunPracticeClientSearch,
  PRACTICE_CLIENT_SEARCH_MIN_QUERY,
} from "@/lib/accounting/firm/practiceClientSearch"

describe("practiceClientSearch eligibility", () => {
  it("includes Finza Service industry", () => {
    expect(isEligiblePracticeClientIndustry("service")).toBe(true)
    expect(isEligiblePracticeClientIndustry("Service")).toBe(true)
  })

  it("includes professional industry used by Service workspace guards", () => {
    expect(isEligiblePracticeClientIndustry("professional")).toBe(true)
  })

  it("excludes retail, null, and empty", () => {
    expect(isEligiblePracticeClientIndustry("retail")).toBe(false)
    expect(isEligiblePracticeClientIndustry(null)).toBe(false)
    expect(isEligiblePracticeClientIndustry("")).toBe(false)
  })

  it("excludes legacy null-industry books-only rows for NEW engagement search", () => {
    expect(isEligiblePracticeClientIndustry(null)).toBe(false)
  })
})

describe("practiceClientSearch selection UX helpers", () => {
  it("clears selection when query diverges from selected name", () => {
    expect(
      shouldClearPracticeClientSelection({
        selectedName: "Acme Services",
        nextQuery: "Acme",
      })
    ).toBe(true)
  })

  it("keeps selection when query still equals selected name", () => {
    expect(
      shouldClearPracticeClientSelection({
        selectedName: "Acme Services",
        nextQuery: "Acme Services",
      })
    ).toBe(false)
  })

  it("does not search below min length", () => {
    expect(
      shouldRunPracticeClientSearch({ query: "a", selectedName: null })
    ).toBe(false)
    expect(PRACTICE_CLIENT_SEARCH_MIN_QUERY).toBe(2)
  })

  it("searches case-preserving queries of sufficient length", () => {
    expect(
      shouldRunPracticeClientSearch({ query: "Fi", selectedName: null })
    ).toBe(true)
  })

  it("skips remote search when query still represents current selection", () => {
    expect(
      shouldRunPracticeClientSearch({
        query: "Finza Load Test Services",
        selectedName: "Finza Load Test Services",
      })
    ).toBe(false)
  })
})

describe("practiceClientSearch create roles", () => {
  it("allows partner and senior", () => {
    expect(isPracticeClientCreateRoles("partner")).toBe(true)
    expect(isPracticeClientCreateRoles("senior")).toBe(true)
  })

  it("denies junior and readonly", () => {
    expect(isPracticeClientCreateRoles("junior")).toBe(false)
    expect(isPracticeClientCreateRoles("readonly")).toBe(false)
  })
})

describe("Practice Add Client Professional entitlement copy", () => {
  it("documents the Professional approval requirement for Partners", () => {
    const fs = require("fs")
    const path = require("path")
    const page = fs.readFileSync(
      path.join(process.cwd(), "app/accounting/firm/clients/add/page.tsx"),
      "utf8"
    )
    expect(page).toContain("Client approval requires Finza Professional or higher.")
  })
})
