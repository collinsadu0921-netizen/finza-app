/**
 * @jest-environment node
 */

import { enforceServiceIndustryMinTier } from "../enforceServiceIndustryMinTier"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "../enforceServiceIndustryBusinessTierForAccountingApi"

describe("enforceServiceIndustryMinTier", () => {
  it("re-exports the shared industry-scoped tier helper", () => {
    expect(enforceServiceIndustryMinTier).toBe(enforceServiceIndustryBusinessTierForAccountingApi)
  })
})
