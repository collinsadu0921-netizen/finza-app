/**
 * Unit tests: mapJobMaterialReturnRpcError
 */
import { describe, it, expect } from "@jest/globals"
import { mapJobMaterialReturnRpcError } from "../jobMaterialReturnErrors"

describe("mapJobMaterialReturnRpcError", () => {
  it("maps USAGE_ALREADY_RETURNED to 409", () => {
    const r = mapJobMaterialReturnRpcError("USAGE_ALREADY_RETURNED: usage has already been returned")
    expect(r.status).toBe(409)
    expect(r.code).toBe("USAGE_ALREADY_RETURNED")
  })

  it("maps PERIOD_LOCKED to 403", () => {
    const r = mapJobMaterialReturnRpcError("PERIOD_LOCKED: period is locked")
    expect(r.status).toBe(403)
    expect(r.code).toBe("PERIOD_LOCKED")
  })

  it("maps USAGE_COGS_LINK_MISSING to 409", () => {
    const r = mapJobMaterialReturnRpcError("USAGE_COGS_LINK_MISSING: refusing to guess")
    expect(r.status).toBe(409)
    expect(r.code).toBe("USAGE_COGS_LINK_MISSING")
  })

  it("maps CROSS_TENANT to 403", () => {
    const r = mapJobMaterialReturnRpcError("CROSS_TENANT: usage does not belong to business")
    expect(r.status).toBe(403)
    expect(r.code).toBe("CROSS_TENANT")
  })

  it("maps USAGE_NOT_FOUND to 404", () => {
    const r = mapJobMaterialReturnRpcError("USAGE_NOT_FOUND: usage record not found")
    expect(r.status).toBe(404)
    expect(r.code).toBe("USAGE_NOT_FOUND")
  })
})
