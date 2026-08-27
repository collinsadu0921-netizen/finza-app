import type { SupabaseClient } from "@supabase/supabase-js"

export type MaterialsWorkspaceFilters = {
  search: string
  status: string
  stock: string
  page: number
  limit: number
}

export type MaterialsWorkspaceSummary = {
  totalItems: number
  activeItems: number
  lowStockItems: number
  totalValue: number
}

export type MaterialsWorkspaceRow = {
  id: string
  name: string
  unit: string
  quantity_on_hand: number
  cost_price: number
  selling_price: number | null
  reorder_level: number
  is_active: boolean
  last_movement_at: string | null
  last_movement_type: string | null
  last_movement_reference_id: string | null
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

export function materialsWorkspacePagination(page: number, limit: number, totalCount: number) {
  return {
    page,
    pageSize: limit,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / limit)),
  }
}

export type MaterialsWorkspacePayload = {
  rows: MaterialsWorkspaceRow[]
  pagination: ReturnType<typeof materialsWorkspacePagination>
  summary: MaterialsWorkspaceSummary
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function asNullableNumber(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null
  return String(value)
}

export function mapMaterialsWorkspaceRpcPayload(
  raw: unknown,
  filters: MaterialsWorkspaceFilters
): MaterialsWorkspacePayload {
  const payload = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const rawRows = Array.isArray(payload.rows) ? payload.rows : []
  const rawSummary =
    payload.summary && typeof payload.summary === "object"
      ? (payload.summary as Record<string, unknown>)
      : {}
  const rawPagination =
    payload.pagination && typeof payload.pagination === "object"
      ? (payload.pagination as Record<string, unknown>)
      : {}

  const rows: MaterialsWorkspaceRow[] = rawRows.map((entry) => {
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {}
    return {
      id: String(row.id ?? ""),
      name: String(row.name ?? ""),
      unit: String(row.unit ?? ""),
      quantity_on_hand: asNumber(row.quantity_on_hand),
      cost_price: asNumber(row.cost_price),
      selling_price: asNullableNumber(row.selling_price),
      reorder_level: asNumber(row.reorder_level),
      is_active: Boolean(row.is_active),
      last_movement_at: asNullableString(row.last_movement_at),
      last_movement_type: asNullableString(row.last_movement_type),
      last_movement_reference_id: asNullableString(row.last_movement_reference_id),
    }
  })

  const totalCount = asNumber(rawPagination.totalCount, rows.length)
  return {
    rows,
    pagination: materialsWorkspacePagination(
      asNumber(rawPagination.page, filters.page) || filters.page,
      asNumber(rawPagination.pageSize, filters.limit) || filters.limit,
      totalCount
    ),
    summary: {
      totalItems: asNumber(rawSummary.totalItems),
      activeItems: asNumber(rawSummary.activeItems),
      lowStockItems: asNumber(rawSummary.lowStockItems),
      totalValue: asNumber(rawSummary.totalValue),
    },
  }
}

export async function loadMaterialsWorkspacePayload(
  supabase: SupabaseClient,
  businessId: string,
  filters: MaterialsWorkspaceFilters
): Promise<MaterialsWorkspacePayload> {
  const { data, error } = await supabase.rpc("get_service_materials_workspace", {
    p_business_id: businessId,
    p_search: filters.search || null,
    p_status: filters.status,
    p_stock: filters.stock,
    p_page: filters.page,
    p_page_size: filters.limit,
  })
  if (error) throw new Error(error.message)
  return mapMaterialsWorkspaceRpcPayload(data, filters)
}
