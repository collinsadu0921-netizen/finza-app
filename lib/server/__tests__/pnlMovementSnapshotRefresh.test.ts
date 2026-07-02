/**
 * @jest-environment node
 */

import { tryRefreshPnlMovementSnapshot } from "../pnlMovementSnapshotRefresh"
import type { SupabaseClient } from "@supabase/supabase-js"

describe("pnlMovementSnapshotRefresh", () => {
  it("parses try_refresh_service_pnl_movement_snapshot response", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { refreshed: true, lock_held: false, period_count: 1 },
      error: null,
    })
    const supabase = { rpc } as unknown as SupabaseClient

    const result = await tryRefreshPnlMovementSnapshot(
      supabase,
      "biz-1",
      "2026-01-01",
      "2026-01-31"
    )

    expect(result).toEqual({ refreshed: true, lockHeld: false })
    expect(rpc).toHaveBeenCalledWith("try_refresh_service_pnl_movement_snapshot", {
      p_business_id: "biz-1",
      p_start_date: "2026-01-01",
      p_end_date: "2026-01-31",
    })
  })
})
