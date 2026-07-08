/**
 * @jest-environment node
 */

import { fetchProfitAndLossMovementRows } from "../pnlMovement"
import type { SupabaseClient } from "@supabase/supabase-js"

const MOVEMENT_ROWS = [
  {
    account_id: "a1",
    account_code: "4000",
    account_name: "Revenue",
    account_type: "income",
    period_total: 100,
  },
]

describe("fetchProfitAndLossMovementRows", () => {
  it("returns snapshot rows when snapshot RPC has data", async () => {
    const rpc = jest.fn((name: string) => {
      if (name === "get_pnl_movement_lines_from_snapshot") {
        return Promise.resolve({ data: MOVEMENT_ROWS, error: null })
      }
<<<<<<< Updated upstream
      if (name === "try_refresh_service_pnl_movement_snapshot") {
        return Promise.resolve({ data: { refreshed: true }, error: null })
      }
      if (name === "get_profit_and_loss_movement") {
        return Promise.resolve({ data: [], error: null })
      }
      return Promise.resolve({ data: null, error: null })
=======
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
      {
      refreshOnRequest: false,
    })

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
      {
      refreshOnRequest: false,
    })

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
      {
      refreshOnRequest: false,
    })

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
>>>>>>> Stashed changes
    })

    const supabase = { rpc } as unknown as SupabaseClient
    const result = await fetchProfitAndLossMovementRows(
      supabase,
      "biz-1",
      "2026-01-01",
      "2026-01-31"
    )

    expect(result.source).toBe("snapshot")
    expect(result.rows).toEqual(MOVEMENT_ROWS)
    expect(rpc).not.toHaveBeenCalledWith("get_profit_and_loss_movement", expect.anything())
    expect(rpc).not.toHaveBeenCalledWith(
      "try_refresh_service_pnl_movement_snapshot",
      expect.anything()
    )
  })

  it("tries reports-only snapshot refresh before live RPC when snapshot is empty", async () => {
    let snapshotReads = 0
    const rpc = jest.fn((name: string) => {
      if (name === "get_pnl_movement_lines_from_snapshot") {
        snapshotReads += 1
        return Promise.resolve({
          data: snapshotReads >= 2 ? MOVEMENT_ROWS : [],
          error: null,
        })
      }
      if (name === "try_refresh_service_pnl_movement_snapshot") {
        return Promise.resolve({
          data: { refreshed: true, lock_held: false },
          error: null,
        })
      }
      if (name === "get_profit_and_loss_movement") {
        return Promise.resolve({ data: [], error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    const supabase = { rpc } as unknown as SupabaseClient
    const result = await fetchProfitAndLossMovementRows(
      supabase,
      "biz-1",
      "2026-01-01",
      "2026-01-31"
    )

    expect(result.source).toBe("snapshot")
    expect(rpc).toHaveBeenCalledWith("try_refresh_service_pnl_movement_snapshot", {
      p_business_id: "biz-1",
      p_start_date: "2026-01-01",
      p_end_date: "2026-01-31",
    })
    expect(rpc).not.toHaveBeenCalledWith("get_profit_and_loss_movement", expect.anything())
  })

  it("falls back to live RPC when snapshot is empty", async () => {
    const rpc = jest.fn((name: string) => {
      if (name === "get_pnl_movement_lines_from_snapshot") {
        return Promise.resolve({ data: [], error: null })
      }
      if (name === "try_refresh_service_pnl_movement_snapshot") {
        return Promise.resolve({
          data: { refreshed: false, lock_held: true },
          error: null,
        })
      }
      if (name === "get_profit_and_loss_movement") {
        return Promise.resolve({ data: MOVEMENT_ROWS, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    const supabase = { rpc } as unknown as SupabaseClient
    const result = await fetchProfitAndLossMovementRows(
      supabase,
      "biz-1",
      "2026-01-01",
      "2026-01-31"
    )

    expect(result.source).toBe("ledger")
    expect(result.rows).toEqual(MOVEMENT_ROWS)
    expect(rpc).toHaveBeenCalledWith("get_profit_and_loss_movement", {
      p_business_id: "biz-1",
      p_start_date: "2026-01-01",
      p_end_date: "2026-01-31",
    })
  })

  it("refreshOnRequest false serves stale snapshot without refresh or live RPC", async () => {
    const rpc = jest.fn((name: string, args?: Record<string, unknown>) => {
      if (name === "get_pnl_movement_lines_from_snapshot") {
        const maxStale = Number(args?.p_max_stale_seconds ?? 0)
        if (maxStale <= 300) {
          return Promise.resolve({ data: [], error: null })
        }
        return Promise.resolve({ data: MOVEMENT_ROWS, error: null })
      }
      if (name === "try_refresh_service_pnl_movement_snapshot") {
        return Promise.resolve({ data: { refreshed: true }, error: null })
      }
      if (name === "get_profit_and_loss_movement") {
        return Promise.resolve({ data: MOVEMENT_ROWS, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    const supabase = { rpc } as unknown as SupabaseClient
    const result = await fetchProfitAndLossMovementRows(
      supabase,
      "biz-1",
      "2026-01-01",
      "2026-01-31",
      { refreshOnRequest: false }
    )

    expect(result.source).toBe("snapshot")
    expect(result.snapshotStale).toBe(true)
    expect(result.rows).toEqual(MOVEMENT_ROWS)
    expect(rpc).not.toHaveBeenCalledWith(
      "try_refresh_service_pnl_movement_snapshot",
      expect.anything()
    )
    expect(rpc).not.toHaveBeenCalledWith("get_profit_and_loss_movement", expect.anything())
  })

  it("refreshOnRequest false returns unavailable when no snapshot exists", async () => {
    const rpc = jest.fn((name: string) => {
      if (name === "get_pnl_movement_lines_from_snapshot") {
        return Promise.resolve({ data: [], error: null })
      }
      if (name === "get_profit_and_loss_movement") {
        return Promise.resolve({ data: MOVEMENT_ROWS, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    const supabase = { rpc } as unknown as SupabaseClient
    const result = await fetchProfitAndLossMovementRows(
      supabase,
      "biz-1",
      "2026-01-01",
      "2026-01-31",
      { refreshOnRequest: false }
    )

    expect(result.source).toBe("unavailable")
    expect(result.rows).toEqual([])
    expect(rpc).not.toHaveBeenCalledWith("get_profit_and_loss_movement", expect.anything())
  })
})
