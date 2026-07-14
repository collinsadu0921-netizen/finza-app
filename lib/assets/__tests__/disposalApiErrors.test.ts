import { mapDisposalRpcError } from "@/lib/assets/disposalApiErrors"

describe("mapDisposalRpcError", () => {
  it("maps depreciation required before disposal", () => {
    const r = mapDisposalRpcError("DEPRECIATION_REQUIRED_BEFORE_DISPOSAL: 2 missing")
    expect(r.code).toBe("DEPRECIATION_REQUIRED_BEFORE_DISPOSAL")
    expect(r.status).toBe(409)
  })

  it("maps account configuration", () => {
    const r = mapDisposalRpcError("ACCOUNT_CONFIGURATION_REQUIRED: 4200 missing")
    expect(r.code).toBe("ACCOUNT_CONFIGURATION_REQUIRED")
    expect(r.status).toBe(422)
  })

  it("maps already disposed", () => {
    const r = mapDisposalRpcError("ASSET_ALREADY_DISPOSED: done")
    expect(r.code).toBe("ASSET_ALREADY_DISPOSED")
  })
})
