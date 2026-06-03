import type { SupabaseClient } from "@supabase/supabase-js"
import { appHrefNeedsUpdate, normalizeAppHref } from "@/lib/navigation/safeReplace"

export const SERVICE_INVOICES_LIST_PATH = "/service/invoices"

export type InvoiceListPagination = {
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export type InvoiceListUrlSyncInput = {
  businessId: string
  page: number
  statusFilter?: string
  /** Existing query string (no leading `?`) to preserve unrelated params. */
  preserveSearch?: string
}

/** Normalize pathname + search for stable equality checks. */
export function normalizeInvoiceListHref(pathname: string, search: string): string {
  return normalizeAppHref(pathname, search)
}

/** Build target list URL path + query (no duplicate `?`, omit `page` when 1). */
export function buildInvoiceListHref(
  pathname: string,
  input: InvoiceListUrlSyncInput
): string {
  const params = new URLSearchParams(input.preserveSearch ?? "")
  params.set("business_id", input.businessId)
  if (input.statusFilter && input.statusFilter !== "all") {
    params.set("status", input.statusFilter)
  } else {
    params.delete("status")
  }
  if (input.page > 1) {
    params.set("page", String(input.page))
  } else {
    params.delete("page")
  }
  const qs = params.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

/** True when router/history should update the URL. */
export function invoiceListHrefNeedsUpdate(
  currentPathname: string,
  currentSearch: string,
  targetHref: string
): boolean {
  return appHrefNeedsUpdate(currentPathname, currentSearch, targetHref)
}

/** Pick the accessible business with the most non-deleted invoices. */
export async function findBusinessWithMostInvoices(
  supabase: SupabaseClient,
  businessIds: string[]
): Promise<string | null> {
  if (businessIds.length === 0) return null
  let bestId: string | null = null
  let bestCount = 0
  for (const id of businessIds) {
    const { count, error } = await supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("business_id", id)
      .is("deleted_at", null)
    if (error) continue
    const n = count ?? 0
    if (n > bestCount) {
      bestCount = n
      bestId = id
    }
  }
  return bestCount > 0 ? bestId : null
}

/**
 * @deprecated Prefer App Router sync via `buildInvoiceListHref` + guarded `router.replace`.
 * Kept for non-Next callers; no-ops when URL already matches.
 */
export function syncInvoiceListUrlBusinessId(businessId: string): void {
  if (typeof window === "undefined") return
  const url = new URL(window.location.href)
  if (url.searchParams.get("business_id") === businessId) return
  url.searchParams.set("business_id", businessId)
  window.history.replaceState({}, "", `${url.pathname}${url.search}`)
}

/** True when the current page is beyond available results and should reset to 1. */
export function shouldResetInvoiceListPage(
  rowCount: number,
  pagination: Pick<InvoiceListPagination, "totalCount" | "totalPages">,
  currentPage: number
): boolean {
  if (rowCount > 0) return false
  if (pagination.totalCount <= 0) return false
  return currentPage > 1 && currentPage > pagination.totalPages
}

export function hasActiveInvoiceListFilters(input: {
  statusFilter: string
  customerFilter: string
  startDate: string
  endDate: string
  searchInput: string
}): boolean {
  return (
    input.statusFilter !== "all" ||
    input.customerFilter !== "all" ||
    Boolean(input.startDate) ||
    Boolean(input.endDate) ||
    Boolean(input.searchInput.trim())
  )
}
