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
      if (name === "try_refresh_service_pnl_movement_snapshot") {
        return Promise.resolve({ data: { refreshed: true }, error: null })
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
