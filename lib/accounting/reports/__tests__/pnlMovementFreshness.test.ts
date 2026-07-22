/**
 * Freshness policy for snapshot-backed P&L reads.
 */

import {
  fetchProfitAndLossMovementRows,
  PNL_MATERIAL_STALE_SECONDS,
} from "../pnlMovement"
import type { SupabaseClient } from "@supabase/supabase-js"

const enqueue = jest.fn().mockResolvedValue("job-1")
const schedule = jest.fn().mockReturnValue({
  scheduled: true,
  reason: "scheduled",
  promise: Promise.resolve(),
  immediate_refresh_enabled: true,
})
const periodHasLive = jest.fn().mockResolvedValue(true)
const ensureZero = jest.fn().mockResolvedValue(false)

jest.mock("@/lib/server/accountingSnapshotRefresh", () => ({
  enqueueSnapshotRefreshJob: (...args: unknown[]) => enqueue(...args),
  scheduleTargetedSnapshotRefresh: (...args: unknown[]) => schedule(...args),
  periodHasLivePnlMovement: (...args: unknown[]) => periodHasLive(...args),
  ensureZeroPnlSnapshotForPeriod: (...args: unknown[]) => ensureZero(...args),
  readPnlSnapshotMetadata: jest.fn(),
  readStalePnlSnapshotMetadata: jest.fn(),
}))

jest.mock("@/lib/server/pnlMovementSnapshotRefresh", () => ({
  readPnlMovementLinesFromSnapshot: jest.fn(),
  readStalePnlMovementLinesFromSnapshot: jest.fn(),
  tryRefreshPnlMovementSnapshot: jest.fn().mockResolvedValue({ refreshed: false, lockHeld: false }),
}))

import {
  readPnlSnapshotMetadata,
  readStalePnlSnapshotMetadata,
} from "@/lib/server/accountingSnapshotRefresh"
import { readPnlMovementLinesFromSnapshot } from "@/lib/server/pnlMovementSnapshotRefresh"

const readFreshMeta = readPnlSnapshotMetadata as jest.Mock
const readStaleMeta = readStalePnlSnapshotMetadata as jest.Mock
const readLines = readPnlMovementLinesFromSnapshot as jest.Mock

function buildSupabase(rpcHandlers: Record<string, unknown> = {}) {
  return {
    rpc: jest.fn(async (name: string) => {
      if (name in rpcHandlers) return rpcHandlers[name]
      return { data: null, error: null }
    }),
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: "period-1" },
        error: null,
      }),
    })),
  } as unknown as SupabaseClient
}

describe("pnlMovement freshness", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    enqueue.mockResolvedValue("job-1")
    schedule.mockReturnValue({
      scheduled: true,
      reason: "scheduled",
      promise: Promise.resolve(),
      immediate_refresh_enabled: true,
    })
    periodHasLive.mockResolvedValue(true)
    ensureZero.mockResolvedValue(false)
  })

  it("defines a material stale threshold beyond the short grace window", () => {
    expect(PNL_MATERIAL_STALE_SECONDS).toBeGreaterThan(60)
    expect(PNL_MATERIAL_STALE_SECONDS).toBeLessThanOrEqual(3600)
  })

  it("returns fresh snapshot on the fast path", async () => {
    readFreshMeta.mockResolvedValue({
      line_count: 1,
      snapshotStale: false,
      refreshed_at: new Date().toISOString(),
    })
    readLines.mockResolvedValue({
      data: [{ account_code: "5110", period_total: 10 }],
      error: null,
    })
    const supabase = buildSupabase()
    const result = await fetchProfitAndLossMovementRows(
      supabase,
      "biz",
      "2026-07-01",
      "2026-07-31",
      { refreshOnRequest: false }
    )
    expect(result.source).toBe("snapshot")
    expect(result.rows[0]?.account_code).toBe("5110")
    expect(enqueue).not.toHaveBeenCalled()
  })

  it("never returns invalidated snapshot as authoritative; uses live fallback", async () => {
    readFreshMeta.mockResolvedValue(null)
    readStaleMeta.mockResolvedValue({
      line_count: 0,
      snapshotStale: true,
      refreshed_at: new Date(Date.now() - 60_000).toISOString(),
    })
    const supabase = buildSupabase({
      get_profit_and_loss_movement: {
        data: [{ account_code: "5110", account_type: "expense", period_total: 25 }],
        error: null,
      },
    })
    const result = await fetchProfitAndLossMovementRows(
      supabase,
      "biz",
      "2026-07-01",
      "2026-07-31",
      { refreshOnRequest: false }
    )
    expect(result.source).toBe("ledger")
    expect(result.rows[0]?.period_total).toBe(25)
    expect(result.snapshotStale).toBe(true)
    expect(enqueue).toHaveBeenCalled()
    expect(schedule).toHaveBeenCalled()
    expect(ensureZero).not.toHaveBeenCalled()
  })

  it("does not return zero_initialized when ledger has movement", async () => {
    readFreshMeta.mockResolvedValue(null)
    readStaleMeta.mockResolvedValue(null)
    periodHasLive.mockResolvedValue(true)
    const supabase = buildSupabase({
      get_profit_and_loss_movement: {
        data: null,
        error: { message: "rpc_down" },
      },
    })
    const result = await fetchProfitAndLossMovementRows(
      supabase,
      "biz",
      "2026-07-01",
      "2026-07-31",
      { refreshOnRequest: false }
    )
    expect(result.source).toBe("unavailable")
    expect(ensureZero).not.toHaveBeenCalled()
  })
})
