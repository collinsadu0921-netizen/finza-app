import { buildServerTimingHeader, createRouteDiag } from "../routeDiagnostics"

describe("routeDiagnostics Server-Timing", () => {
  it("buildServerTimingHeader formats entries", () => {
    const header = buildServerTimingHeader([
      { name: "auth", dur: 12.3, desc: "session" },
      { name: "db_query", dur: 450 },
    ])
    expect(header).toContain("auth;dur=12.3;desc=\"session\"")
    expect(header).toContain("db_query;dur=450")
  })

  it("createRouteDiag accumulates recordTiming for serverTimingHeader", () => {
    const diag = createRouteDiag("test_route")
    diag.recordTiming("auth", 5)
    diag.recordTiming("scope", 10)
    const header = diag.serverTimingHeader()
    expect(header).toContain("auth;dur=5")
    expect(header).toContain("scope;dur=10")
  })
})
