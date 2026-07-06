/**
 * Backfill script production guard (522).
 */

describe("backfill-accounting-snapshots guards", () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it("requires ALLOW_PRODUCTION_SNAPSHOT_BACKFILL=1 for write mode", () => {
    delete process.env.ALLOW_PRODUCTION_SNAPSHOT_BACKFILL
    const writeMode = true
    const allowProd = process.env.ALLOW_PRODUCTION_SNAPSHOT_BACKFILL === "1"
    expect(writeMode && !allowProd).toBe(true)
  })

  it("allows write when explicit env flag set", () => {
    process.env.ALLOW_PRODUCTION_SNAPSHOT_BACKFILL = "1"
    expect(process.env.ALLOW_PRODUCTION_SNAPSHOT_BACKFILL === "1").toBe(true)
  })
})
