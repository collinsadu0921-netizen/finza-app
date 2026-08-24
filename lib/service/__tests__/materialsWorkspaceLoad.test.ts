import { describe, expect, it, jest } from "@jest/globals"
import {
  assembleMaterialsWorkspaceRows,
  firstMovementByMaterial,
  isLowStockRow,
  loadLastMovementsForMaterials,
  loadMaterialsWorkspacePage,
  loadMaterialsWorkspaceSummary,
  materialCostPrice,
  materialsWorkspacePagination,
  parseMaterialsWorkspaceFilters,
  summarizeMaterialsInventory,
} from "@/lib/service/materialsWorkspaceLoad"

function inventoryRow(overrides: Partial<{
  id: string
  name: string
  unit: string
  quantity_on_hand: number
  average_cost: number
  default_cost_price: number | null
  reorder_level: number
  is_active: boolean
  default_selling_price: number | null
}> = {}) {
  return {
    id: "mat-1",
    name: "Ac units",
    unit: "pcs",
    quantity_on_hand: 94,
    average_cost: 10,
    default_cost_price: 10,
    reorder_level: 0,
    is_active: true,
    default_selling_price: 20,
    ...overrides,
  }
}

describe("materials workspace load helpers", () => {
  it("parses pagination bounds", () => {
    const filters = parseMaterialsWorkspaceFilters(
      new URLSearchParams("page=0&limit=999&status=all&stock=all")
    )
    expect(filters.page).toBe(1)
    expect(filters.limit).toBe(100)
  })

  it("derives summary from one inventory scan", () => {
    const summary = summarizeMaterialsInventory([
      inventoryRow({ is_active: true, quantity_on_hand: 2, average_cost: 5, reorder_level: 0 }),
      inventoryRow({ is_active: true, quantity_on_hand: 1, average_cost: 4, reorder_level: 3 }),
      inventoryRow({ is_active: false, quantity_on_hand: 8, average_cost: 1, reorder_level: 1 }),
    ])
    expect(summary).toEqual({
      totalItems: 3,
      activeItems: 2,
      lowStockItems: 1,
      totalValue: 2 * 5 + 1 * 4 + 8 * 1,
    })
  })

  it("keeps cost as default_cost_price when present", () => {
    expect(materialCostPrice(inventoryRow({ default_cost_price: 21.43, average_cost: 20 }))).toBe(21.43)
    expect(materialCostPrice(inventoryRow({ default_cost_price: null, average_cost: 20 }))).toBe(20)
  })

  it("keeps the first movement after created_at desc", () => {
    const last = firstMovementByMaterial([
      { material_id: "a", created_at: "2026-08-02", movement_type: "use", reference_id: "2" },
      { material_id: "a", created_at: "2026-08-01", movement_type: "add", reference_id: "1" },
      { material_id: "b", created_at: "2026-08-03", movement_type: "add", reference_id: null },
    ])
    expect(last.a.created_at).toBe("2026-08-02")
    expect(last.b.movement_type).toBe("add")
  })

  it("assembles the current UI/API row contract", () => {
    const rows = assembleMaterialsWorkspaceRows(
      [inventoryRow({ id: "a", default_selling_price: null })],
      { a: { created_at: "2026-07-22", movement_type: "job_usage", reference_id: "ref-1" } }
    )
    expect(rows).toEqual([
      {
        id: "a",
        name: "Ac units",
        unit: "pcs",
        quantity_on_hand: 94,
        cost_price: 10,
        selling_price: null,
        reorder_level: 0,
        is_active: true,
        last_movement_at: "2026-07-22",
        last_movement_type: "job_usage",
        last_movement_reference_id: "ref-1",
      },
    ])
  })

  it("paginates with a minimum of one page", () => {
    expect(materialsWorkspacePagination(1, 25, 0)).toEqual({
      page: 1,
      pageSize: 25,
      totalCount: 0,
      totalPages: 1,
    })
    expect(materialsWorkspacePagination(2, 25, 7).totalPages).toBe(1)
  })

  it("does not treat inactive or zero reorder as low stock", () => {
    expect(isLowStockRow({ is_active: false, reorder_level: 5, quantity_on_hand: 1 })).toBe(false)
    expect(isLowStockRow({ is_active: true, reorder_level: 0, quantity_on_hand: 0 })).toBe(false)
    expect(isLowStockRow({ is_active: true, reorder_level: 5, quantity_on_hand: 5 })).toBe(true)
  })
})

describe("materials workspace query fan-out", () => {
  it("issues one page query and one summary query, then one movements query", async () => {
    const tables: string[] = []
    const pageRows = [inventoryRow({ id: "a" })]
    const supabase = {
      from(table: string) {
        tables.push(table)
        const chain: Record<string, unknown> = {}
        const self = () => chain
        chain.select = jest.fn(self)
        chain.eq = jest.fn(self)
        chain.or = jest.fn(self)
        chain.in = jest.fn(self)
        chain.order = jest.fn(self)
        chain.range = jest.fn(async () => ({ data: pageRows, count: 7, error: null }))
        chain.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data:
              table === "service_material_inventory"
                ? [{ quantity_on_hand: 1, average_cost: 2, reorder_level: 0, is_active: true }]
                : [
                    {
                      material_id: "a",
                      created_at: "2026-07-22",
                      movement_type: "job_usage",
                      reference_id: "ref-1",
                    },
                  ],
            error: null,
          }).then(resolve)
        return chain
      },
    }

    const filters = parseMaterialsWorkspaceFilters(new URLSearchParams("page=1&limit=25"))
    const [page, summary] = await Promise.all([
      loadMaterialsWorkspacePage(supabase as never, "biz-a", filters),
      loadMaterialsWorkspaceSummary(supabase as never, "biz-a"),
    ])
    const movements = await loadLastMovementsForMaterials(
      supabase as never,
      "biz-a",
      page.materials.map((row) => row.id)
    )

    expect(page.count).toBe(7)
    expect(summary.totalItems).toBe(1)
    expect(movements.a.movement_type).toBe("job_usage")
    expect(tables.filter((name) => name === "service_material_inventory")).toHaveLength(2)
    expect(tables.filter((name) => name === "service_material_movements")).toHaveLength(1)
    expect(tables).not.toContain("businesses")
  })

  it("scopes every inventory and movement read to the server business id", async () => {
    const scoped: Array<{ table: string; col: string; value: unknown }> = []
    const supabase = {
      from(table: string) {
        const chain: Record<string, unknown> = {}
        const self = () => chain
        chain.select = jest.fn(self)
        chain.eq = jest.fn((col: string, value: unknown) => {
          scoped.push({ table, col, value })
          return chain
        })
        chain.in = jest.fn(self)
        chain.order = jest.fn(self)
        chain.range = jest.fn(async () => ({ data: [], count: 0, error: null }))
        chain.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve)
        return chain
      },
    }

    const filters = parseMaterialsWorkspaceFilters(new URLSearchParams("page=1&limit=25"))
    await loadMaterialsWorkspacePage(supabase as never, "biz-a", filters)
    await loadMaterialsWorkspaceSummary(supabase as never, "biz-a")
    await loadLastMovementsForMaterials(supabase as never, "biz-a", ["mat-1"])

    const businessScopes = scoped.filter((entry) => entry.col === "business_id")
    expect(businessScopes.length).toBeGreaterThanOrEqual(3)
    expect(businessScopes.every((entry) => entry.value === "biz-a")).toBe(true)
    expect(businessScopes.some((entry) => entry.value === "biz-b")).toBe(false)
  })
})
