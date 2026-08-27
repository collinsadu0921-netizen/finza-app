import { describe, expect, it } from "@jest/globals"
import {
  loadMaterialsWorkspacePayload,
  mapMaterialsWorkspaceRpcPayload,
  parseMaterialsWorkspaceFilters,
} from "@/lib/service/materialsWorkspaceLoad"

describe("materials workspace RPC mapping", () => {
  it("parses pagination bounds", () => {
    const filters = parseMaterialsWorkspaceFilters(
      new URLSearchParams("page=0&limit=999&status=all&stock=all")
    )
    expect(filters.page).toBe(1)
    expect(filters.limit).toBe(100)
  })

  it("maps the composite RPC payload used by the HTTP route", () => {
    const mapped = mapMaterialsWorkspaceRpcPayload(
      {
        rows: [
          {
            id: "mat-1",
            name: "Ac units",
            unit: "pcs",
            quantity_on_hand: 94,
            cost_price: 10,
            selling_price: 20,
            reorder_level: 0,
            is_active: true,
            last_movement_at: "2026-08-01",
            last_movement_type: "add",
            last_movement_reference_id: null,
          },
        ],
        pagination: { page: 1, pageSize: 25, totalCount: 1, totalPages: 1 },
        summary: { totalItems: 1, activeItems: 1, lowStockItems: 0, totalValue: 940 },
      },
      { search: "", status: "all", stock: "all", page: 1, limit: 25 }
    )
    expect(mapped.rows[0]).toMatchObject({
      id: "mat-1",
      quantity_on_hand: 94,
      cost_price: 10,
      selling_price: 20,
    })
    expect(mapped.summary.totalValue).toBe(940)
    expect(mapped.pagination.totalCount).toBe(1)
  })

  it("calls get_service_materials_workspace with filter args", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { rows: [], pagination: { page: 2, pageSize: 10, totalCount: 0 }, summary: {} },
      error: null,
    })
    const payload = await loadMaterialsWorkspacePayload(
      { rpc } as never,
      "biz-1",
      { search: "ac", status: "active", stock: "low", page: 2, limit: 10 }
    )
    expect(rpc).toHaveBeenCalledWith("get_service_materials_workspace", {
      p_business_id: "biz-1",
      p_search: "ac",
      p_status: "active",
      p_stock: "low",
      p_page: 2,
      p_page_size: 10,
    })
    expect(payload.pagination.page).toBe(2)
  })
})
