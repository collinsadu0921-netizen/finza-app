import type { SupabaseClient } from "@supabase/supabase-js"

export const MATERIALS_WORKSPACE_PAGE_COLUMNS =
  "id, name, unit, quantity_on_hand, average_cost, default_cost_price, reorder_level, is_active, default_selling_price"

export const MATERIALS_WORKSPACE_SUMMARY_COLUMNS =
  "quantity_on_hand, average_cost, reorder_level, is_active"

export type MaterialsWorkspaceFilters = {
  search: string
  status: string
  stock: string
  page: number
  limit: number
}

export type MaterialsInventoryRow = {
  id: string
  name: string
  unit: string
  quantity_on_hand: number
  average_cost: number
  default_cost_price: number | null
  reorder_level: number
  is_active: boolean
  default_selling_price: number | null
}

export type MaterialsSummaryRow = {
  quantity_on_hand: number
  average_cost: number
  reorder_level: number
  is_active: boolean
}

export type MaterialsWorkspaceSummary = {
  totalItems: number
  activeItems: number
  lowStockItems: number
  totalValue: number
}

export type LastMovement = {
  created_at: string
  movement_type: string
  reference_id: string | null
}

export function parseMaterialsWorkspaceFilters(searchParams: URLSearchParams): MaterialsWorkspaceFilters {
  const search = (searchParams.get("search") || "").trim()
  const status = (searchParams.get("status") || "all").trim()
  const stock = (searchParams.get("stock") || "all").trim()
  const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1)
  const limitRaw = Number.parseInt(searchParams.get("limit") || "25", 10) || 25
  const limit = Math.min(100, Math.max(1, limitRaw))
  return { search, status, stock, page, limit }
}

export function isLowStockRow(row: {
  is_active: boolean
  reorder_level: number
  quantity_on_hand: number
}): boolean {
  return row.is_active && Number(row.reorder_level) > 0 && Number(row.quantity_on_hand) <= Number(row.reorder_level)
}

export function summarizeMaterialsInventory(rows: MaterialsSummaryRow[]): MaterialsWorkspaceSummary {
  let activeItems = 0
  let lowStockItems = 0
  let totalValue = 0
  for (const row of rows) {
    if (row.is_active) activeItems += 1
    if (isLowStockRow(row)) lowStockItems += 1
    totalValue += Number(row.quantity_on_hand || 0) * Number(row.average_cost || 0)
  }
  return {
    totalItems: rows.length,
    activeItems,
    lowStockItems,
    totalValue,
  }
}

export function materialCostPrice(row: MaterialsInventoryRow): number {
  return row.default_cost_price != null ? Number(row.default_cost_price) : Number(row.average_cost ?? 0)
}

export function firstMovementByMaterial(
  movements: Array<{
    material_id: string
    created_at: string
    movement_type: string
    reference_id: string | null
  }>
): Record<string, LastMovement> {
  const lastByMaterial: Record<string, LastMovement> = {}
  for (const movement of movements) {
    if (lastByMaterial[movement.material_id]) continue
    lastByMaterial[movement.material_id] = {
      created_at: movement.created_at,
      movement_type: movement.movement_type,
      reference_id: movement.reference_id ?? null,
    }
  }
  return lastByMaterial
}

export function assembleMaterialsWorkspaceRows(
  list: MaterialsInventoryRow[],
  lastByMaterial: Record<string, LastMovement>
) {
  return list.map((row) => {
    const last = lastByMaterial[row.id]
    return {
      id: row.id,
      name: row.name,
      unit: row.unit,
      quantity_on_hand: row.quantity_on_hand,
      cost_price: materialCostPrice(row),
      selling_price: row.default_selling_price != null ? Number(row.default_selling_price) : null,
      reorder_level: row.reorder_level,
      is_active: row.is_active,
      last_movement_at: last?.created_at ?? null,
      last_movement_type: last?.movement_type ?? null,
      last_movement_reference_id: last?.reference_id ?? null,
    }
  })
}

export async function loadMaterialsWorkspacePage(
  supabase: SupabaseClient,
  businessId: string,
  filters: MaterialsWorkspaceFilters
): Promise<{ materials: MaterialsInventoryRow[]; count: number }> {
  const from = (filters.page - 1) * filters.limit
  const to = from + filters.limit - 1

  let materialQuery = supabase
    .from("service_material_inventory")
    .select(MATERIALS_WORKSPACE_PAGE_COLUMNS, { count: "exact" })
    .eq("business_id", businessId)

  if (filters.search) {
    materialQuery = materialQuery.or(`name.ilike.%${filters.search}%,sku.ilike.%${filters.search}%`)
  }
  if (filters.status === "active") materialQuery = materialQuery.eq("is_active", true)
  if (filters.status === "inactive") materialQuery = materialQuery.eq("is_active", false)

  if (filters.stock === "all") {
    const result = await materialQuery.order("name", { ascending: true }).range(from, to)
    if (result.error) throw new Error(result.error.message)
    return {
      materials: (result.data ?? []) as MaterialsInventoryRow[],
      count: result.count ?? 0,
    }
  }

  let prefilterQuery = supabase
    .from("service_material_inventory")
    .select(MATERIALS_WORKSPACE_PAGE_COLUMNS)
    .eq("business_id", businessId)
  if (filters.search) {
    prefilterQuery = prefilterQuery.or(`name.ilike.%${filters.search}%,sku.ilike.%${filters.search}%`)
  }
  if (filters.status === "active") prefilterQuery = prefilterQuery.eq("is_active", true)
  if (filters.status === "inactive") prefilterQuery = prefilterQuery.eq("is_active", false)

  const prefiltered = await prefilterQuery.order("name", { ascending: true })
  if (prefiltered.error) throw new Error(prefiltered.error.message)

  const scoped = ((prefiltered.data ?? []) as MaterialsInventoryRow[]).filter((row) => {
    const low = isLowStockRow(row)
    return filters.stock === "low" ? low : !low
  })
  return {
    materials: scoped.slice(from, to + 1),
    count: scoped.length,
  }
}

export async function loadMaterialsWorkspaceSummary(
  supabase: SupabaseClient,
  businessId: string
): Promise<MaterialsWorkspaceSummary> {
  const { data, error } = await supabase
    .from("service_material_inventory")
    .select(MATERIALS_WORKSPACE_SUMMARY_COLUMNS)
    .eq("business_id", businessId)

  if (error) throw new Error(error.message)
  return summarizeMaterialsInventory((data ?? []) as MaterialsSummaryRow[])
}

export async function loadLastMovementsForMaterials(
  supabase: SupabaseClient,
  businessId: string,
  materialIds: string[]
): Promise<Record<string, LastMovement>> {
  if (materialIds.length === 0) return {}

  const { data, error } = await supabase
    .from("service_material_movements")
    .select("material_id, created_at, movement_type, reference_id")
    .eq("business_id", businessId)
    .in("material_id", materialIds)
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)
  return firstMovementByMaterial(
    (data ?? []) as Array<{
      material_id: string
      created_at: string
      movement_type: string
      reference_id: string | null
    }>
  )
}

export function materialsWorkspacePagination(page: number, limit: number, totalCount: number) {
  return {
    page,
    pageSize: limit,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / limit)),
  }
}
