/**
 * Freshness policy for snapshot-backed P&L reads.
 */

import { PNL_MATERIAL_STALE_SECONDS } from "../pnlMovement"

describe("pnlMovement freshness constants", () => {
  it("defines a material stale threshold beyond the short grace window", () => {
    expect(PNL_MATERIAL_STALE_SECONDS).toBeGreaterThan(60)
    expect(PNL_MATERIAL_STALE_SECONDS).toBeLessThanOrEqual(3600)
  })
})
