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
  })

  it("falls back to live RPC when snapshot is empty", async () => {
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
})
