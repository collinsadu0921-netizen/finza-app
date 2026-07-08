/**
 * P&L movement metadata-first reads (522).
 */

import { fetchProfitAndLossMovementRows } from "../pnlMovement"
import type { SupabaseClient } from "@supabase/supabase-js"

jest.mock("@/lib/server/accountingSnapshotRefresh", () => ({
  readPnlSnapshotMetadata: jest.fn(),
  readStalePnlSnapshotMetadata: jest.fn(),
  periodHasLivePnlMovement: jest.fn(),
  enqueueSnapshotRefreshJob: jest.fn(),
  ensureZeroPnlSnapshotForPeriod: jest.fn(),
}))

jest.mock("@/lib/server/pnlMovementSnapshotRefresh", () => ({
  readPnlMovementLinesFromSnapshot: jest.fn(),
  readStalePnlMovementLinesFromSnapshot: jest.fn(),
  tryRefreshPnlMovementSnapshot: jest.fn(),
}))

import {
  ensureZeroPnlSnapshotForPeriod,
  enqueueSnapshotRefreshJob,
  periodHasLivePnlMovement,
  readPnlSnapshotMetadata,
  readStalePnlSnapshotMetadata,
} from "@/lib/server/accountingSnapshotRefresh"
import {
  readPnlMovementLinesFromSnapshot,
  tryRefreshPnlMovementSnapshot,
} from "@/lib/server/pnlMovementSnapshotRefresh"

const mockReadMeta = readPnlSnapshotMetadata as jest.MockedFunction<typeof readPnlSnapshotMetadata>
const mockReadStaleMeta = readStalePnlSnapshotMetadata as jest.MockedFunction<
  typeof readStalePnlSnapshotMetadata
>
const mockHasLive = periodHasLivePnlMovement as jest.MockedFunction<typeof periodHasLivePnlMovement>
const mockEnqueue = enqueueSnapshotRefreshJob as jest.MockedFunction<typeof enqueueSnapshotRefreshJob>
const mockEnsureZero = ensureZeroPnlSnapshotForPeriod as jest.MockedFunction<
  typeof ensureZeroPnlSnapshotForPeriod
>
const mockReadLines = readPnlMovementLinesFromSnapshot as jest.MockedFunction<
  typeof readPnlMovementLinesFromSnapshot
>
const mockTryRefresh = tryRefreshPnlMovementSnapshot as jest.MockedFunction<
  typeof tryRefreshPnlMovementSnapshot
>

function buildSupabase(options: {
  exactAccountingPeriod?: boolean
  movementRows?: Array<{ account_code?: string; account_type?: string; period_total?: number }>
}) {
  const rpc = jest.fn((name: string) => {
    if (name === "get_profit_and_loss_movement") {
      return Promise.resolve({ data: options.movementRows ?? [], error: null })
    }
    return Promise.resolve({ data: null, error: null })
  })

  const from = jest.fn((table: string) => {
    if (table === "accounting_periods") {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue(
          options.exactAccountingPeriod
            ? { data: { id: "period-1" }, error: null }
            : { data: null, error: null }
        ),
      }
    }
    return {}
  })

  return { rpc, from } as unknown as SupabaseClient
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe("fetchProfitAndLossMovementRows metadata-first", () => {
  it("returns valid zero P&L when metadata line_count is 0", async () => {
    mockReadMeta.mockResolvedValue({
      line_count: 0,
      revenue: 0,
      expenses: 0,
      net_profit: 0,
      refreshed_at: new Date().toISOString(),
      source_version: 522,
      snapshotStale: false,
    })

    const result = await fetchProfitAndLossMovementRows(
      buildSupabase({ exactAccountingPeriod: true }),
      "biz",
      "2026-05-01",
      "2026-05-31",
      { refreshOnRequest: false }
    )

    expect(result.source).toBe("snapshot")
    expect(result.rows).toEqual([])
    expect(result.error).toBe("")
  })

  it("returns snapshot lines when metadata line_count > 0", async () => {
    mockReadMeta.mockResolvedValue({
      line_count: 2,
      revenue: 100,
      expenses: 40,
      net_profit: 60,
      refreshed_at: new Date().toISOString(),
      source_version: 522,
      snapshotStale: false,
    })
    mockReadLines.mockResolvedValue({
      data: [{ account_code: "4000", period_total: 100 }],
      error: null,
    } as any)

    const result = await fetchProfitAndLossMovementRows(
      buildSupabase({ exactAccountingPeriod: true }),
      "biz",
      "2026-05-01",
      "2026-05-31",
      { refreshOnRequest: false }
    )

    expect(result.source).toBe("snapshot")
    expect(result.rows).toHaveLength(1)
  })

  it("falls back to live ledger when live movement exists but snapshot metadata missing", async () => {
    mockReadMeta.mockResolvedValue(null)
    mockReadStaleMeta.mockResolvedValue(null)
    mockHasLive.mockResolvedValue(true)
    mockEnqueue.mockResolvedValue("job-1")
    const supabase = buildSupabase({
      exactAccountingPeriod: true,
      movementRows: [{ account_code: "6000", account_type: "expense", period_total: 1130 }],
    })

    const result = await fetchProfitAndLossMovementRows(
      supabase,
      "biz",
      "2026-05-01",
      "2026-05-31",
      { refreshOnRequest: false }
    )

    expect(result.source).toBe("ledger")
    expect(result.refreshJobId).toBe("job-1")
    expect(result.rows).toHaveLength(1)
    expect(mockEnqueue).toHaveBeenCalled()
  })

  it("initializes zero snapshot when no live movement and metadata missing", async () => {
    mockReadMeta.mockResolvedValue(null)
    mockReadStaleMeta.mockResolvedValue(null)
    mockHasLive.mockResolvedValue(false)
    mockEnsureZero.mockResolvedValue(true)

    const result = await fetchProfitAndLossMovementRows(
      buildSupabase({ exactAccountingPeriod: true }),
      "biz",
      "2026-05-01",
      "2026-05-31",
      { refreshOnRequest: false }
    )

    expect(result.source).toBe("zero_initialized")
    expect(result.rows).toEqual([])
    expect(mockEnsureZero).toHaveBeenCalled()
  })

  it("falls back to live RPC when refreshOnRequest enabled", async () => {
    mockReadMeta.mockResolvedValue(null)
    mockReadStaleMeta.mockResolvedValue(null)
    mockTryRefresh.mockResolvedValue({ refreshed: false, lockHeld: false })
    const supabase = buildSupabase({
      movementRows: [{ account_code: "6000", period_total: 50 }],
    })

    const result = await fetchProfitAndLossMovementRows(supabase, "biz", "2026-05-01", "2026-05-31", {
      refreshOnRequest: true,
    })

    expect(result.source).toBe("ledger")
    expect(supabase.rpc).toHaveBeenCalledWith("get_profit_and_loss_movement", expect.any(Object))
  })

  it("custom range May–July uses live RPC when snapshot misses (not exact period)", async () => {
    mockReadMeta.mockResolvedValue(null)
    mockReadStaleMeta.mockResolvedValue(null)
    const supabase = buildSupabase({
      exactAccountingPeriod: false,
      movementRows: [
        {
          account_code: "6000",
          account_type: "expense",
          period_total: 2260,
        },
      ],
    })

    const result = await fetchProfitAndLossMovementRows(
      supabase,
      "biz",
      "2026-05-01",
      "2026-07-31",
      { refreshOnRequest: false }
    )

    expect(result.source).toBe("ledger")
    expect(result.error).toBe("")
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].period_total).toBe(2260)
    expect(supabase.rpc).toHaveBeenCalledWith("get_profit_and_loss_movement", {
      p_business_id: "biz",
      p_start_date: "2026-05-01",
      p_end_date: "2026-07-31",
    })
    expect(mockHasLive).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it("June exact period still returns fresh snapshot with expenses 1130", async () => {
    mockReadMeta.mockResolvedValue({
      line_count: 1,
      revenue: 0,
      expenses: 1130,
      net_profit: -1130,
      refreshed_at: new Date().toISOString(),
      source_version: 522,
      snapshotStale: false,
    })
    mockReadLines.mockResolvedValue({
      data: [
        {
          account_code: "6000",
          account_name: "Payroll",
          account_type: "expense",
          period_total: 1130,
        },
      ],
      error: null,
    } as any)

    const result = await fetchProfitAndLossMovementRows(
      buildSupabase({ exactAccountingPeriod: true }),
      "biz",
      "2026-06-01",
      "2026-06-30",
      { refreshOnRequest: false }
    )

    expect(result.source).toBe("snapshot")
    expect(result.snapshotStale).toBe(false)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].period_total).toBe(1130)
    expect(mockReadLines).toHaveBeenCalled()
  })
})
