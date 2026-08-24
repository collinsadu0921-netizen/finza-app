/**
 * Materials workspace GET is session-scoped on the server (no business_id in the URL).
 * Client cache identity must still include the authoritative workspace business.
 */
export function materialsWorkspaceCacheKey(
  url: string,
  businessId: string | null | undefined
): string | null {
  const id = typeof businessId === "string" ? businessId.trim() : ""
  if (!id) return null
  return `${url}::${id}`
}

export function buildMaterialsWorkspaceUrl(params: {
  search?: string
  status?: string
  stock?: string
  page: number
  limit: number
}): string {
  const searchParams = new URLSearchParams()
  if (params.search) searchParams.set("search", params.search)
  if (params.status && params.status !== "all") searchParams.set("status", params.status)
  if (params.stock && params.stock !== "all") searchParams.set("stock", params.stock)
  searchParams.set("page", String(params.page))
  searchParams.set("limit", String(params.limit))
  return `/api/service/materials/workspace?${searchParams.toString()}`
}
