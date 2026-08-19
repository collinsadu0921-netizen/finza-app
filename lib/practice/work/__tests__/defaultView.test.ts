import { defaultPracticeWorkView, resolvePracticeWorkView } from "../defaultView"

describe("defaultPracticeWorkView", () => {
  it("defaults partner to all", () => {
    expect(defaultPracticeWorkView("partner")).toBe("all")
  })

  it("defaults senior, junior, and readonly to my", () => {
    expect(defaultPracticeWorkView("senior")).toBe("my")
    expect(defaultPracticeWorkView("junior")).toBe("my")
    expect(defaultPracticeWorkView("readonly")).toBe("my")
  })
})

describe("resolvePracticeWorkView", () => {
  it("honors explicit view=all for restricted roles", () => {
    expect(resolvePracticeWorkView({ role: "junior", viewParam: "all" })).toBe("all")
  })

  it("honors explicit view=unassigned", () => {
    expect(resolvePracticeWorkView({ role: "senior", viewParam: "unassigned" })).toBe("unassigned")
  })

  it("honors explicit view=my", () => {
    expect(resolvePracticeWorkView({ role: "partner", viewParam: "my" })).toBe("my")
  })

  it("applies role default when view is missing or invalid", () => {
    expect(resolvePracticeWorkView({ role: "partner", viewParam: null })).toBe("all")
    expect(resolvePracticeWorkView({ role: "senior", viewParam: undefined })).toBe("my")
    expect(resolvePracticeWorkView({ role: "junior", viewParam: "" })).toBe("my")
    expect(resolvePracticeWorkView({ role: "readonly", viewParam: "bogus" })).toBe("my")
  })
})
