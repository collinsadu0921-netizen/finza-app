import { mapDepreciationRpcError } from "../depreciationApiErrors"

describe("mapDepreciationRpcError", () => {
  it("maps duplicate posting to 409", () => {
    const mapped = mapDepreciationRpcError("Depreciation already posted for this asset and date")
    expect(mapped.status).toBe(409)
    expect(mapped.code).toBe("DUPLICATE_POSTING")
  })

  it("maps period closed to 403", () => {
    const mapped = mapDepreciationRpcError("Accounting period is locked for this date")
    expect(mapped.status).toBe(403)
    expect(mapped.code).toBe("PERIOD_CLOSED")
  })

  it("maps unauthorized to 403", () => {
    const mapped = mapDepreciationRpcError("Not authorized to post depreciation for this business")
    expect(mapped.status).toBe(403)
    expect(mapped.code).toBe("FORBIDDEN")
  })

  it("maps account configuration to 422", () => {
    const mapped = mapDepreciationRpcError(
      "ACCOUNT_CONFIGURATION_REQUIRED: Depreciation expense account (5700) not found for business x"
    )
    expect(mapped.status).toBe(422)
    expect(mapped.code).toBe("ACCOUNT_CONFIGURATION_REQUIRED")
  })

  it("maps incomplete entry to 409", () => {
    const mapped = mapDepreciationRpcError(
      "Incomplete depreciation entry exists for this asset and date; reconciliation required"
    )
    expect(mapped.status).toBe(409)
    expect(mapped.code).toBe("INCOMPLETE_ENTRY")
  })
})
