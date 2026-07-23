import { afterAccountingPost } from "../afterAccountingPost"

const schedule = jest.fn().mockReturnValue({
  scheduled: true,
  reason: "scheduled",
  promise: Promise.resolve(),
  immediate_refresh_enabled: true,
  period_start: "2026-07-01",
  period_end: "2026-07-31",
})
const invalidate = jest.fn().mockResolvedValue(undefined)

jest.mock("../accountingSnapshotRefresh", () => ({
  scheduleTargetedSnapshotRefresh: (...args: unknown[]) => schedule(...args),
}))

jest.mock("../accountingSnapshotCacheInvalidation", () => ({
  invalidateAccountingCachesForBusiness: (...args: unknown[]) => invalidate(...args),
}))

describe("afterAccountingPost", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("invalidates caches and schedules targeted refresh without awaiting rebuild", async () => {
    const result = await afterAccountingPost({
      businessId: "biz-1",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      source: "material_consume",
    })
    expect(invalidate).toHaveBeenCalledWith("biz-1")
    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz-1",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        triggerSource: "post_transaction",
      })
    )
    expect(result.scheduled).toBe(true)
  })

  it("still invalidates caches when period cannot be resolved", async () => {
    const result = await afterAccountingPost({
      businessId: "biz-1",
      source: "material_consume",
    })
    expect(invalidate).toHaveBeenCalledWith("biz-1")
    expect(schedule).not.toHaveBeenCalled()
    expect(result.reason).toBe("period_unresolved")
  })
})
