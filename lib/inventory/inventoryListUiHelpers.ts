import { DEFAULT_RETAIL_INVENTORY_PAGE_SIZE } from "@/lib/inventory/loadRetailInventoryPageData"

/** Zero-based last valid page index for a total count and page size. */
export function inventoryMaxPageIndex(
  totalCount: number,
  pageSize: number = DEFAULT_RETAIL_INVENTORY_PAGE_SIZE
): number {
  if (totalCount <= 0) return 0
  return Math.max(0, Math.ceil(totalCount / pageSize) - 1)
}

/**
 * After a successful list fetch, decide whether the current page index is still valid.
 * If not, return the page to navigate to; caller should setPage and discard this response
 * so the next fetch loads the correct slice.
 */
export function resolveInventoryRepageAfterFetch(args: {
  currentPage: number
  nextTotal: number
  nextProductsLength: number
  pageSize?: number
}): number | null {
  const { currentPage, nextTotal, nextProductsLength } = args
  const pageSize = args.pageSize ?? DEFAULT_RETAIL_INVENTORY_PAGE_SIZE

  if (nextTotal <= 0) {
    return currentPage !== 0 ? 0 : null
  }

  const maxPage = inventoryMaxPageIndex(nextTotal, pageSize)
  if (currentPage > maxPage) {
    return maxPage
  }
  if (nextProductsLength === 0 && currentPage > 0) {
    return maxPage
  }
  return null
}

type DeleteErr = { message?: string; code?: string; details?: string | null; hint?: string | null }

/** User-facing copy for variant delete failures (constraints, RLS, network). */
export function describeInventoryVariantDeleteError(err: DeleteErr | null | undefined): string {
  const raw = (err?.message || "").trim()
  const code = err?.code || ""

  if (code === "23503" || /foreign key|violates foreign key constraint/i.test(raw)) {
    return "This variant cannot be deleted while it is still referenced (for example by sales, stock movements, or other records). Resolve those references first, or ask an administrator."
  }
  if (code === "42501" || /permission denied|row-level security|RLS/i.test(raw)) {
    return "You do not have permission to delete this variant. Ask an owner or admin to adjust your access."
  }
  if (raw) return raw
  return "Could not delete this variant. Please try again."
}

function inventoryPathnameKey(path: string): string {
  const p = path.split("?")[0] || ""
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1)
  return p
}

/**
 * True when navigation landed on the inventory list path coming directly from an add-stock URL.
 * Used to trigger the same reload as `bumpReload()` after stock adjustment flows.
 */
export function inventoryNavigatedFromAddStockToList(
  currentPath: string,
  previousPath: string | null,
  inventoryListPath: string
): boolean {
  const cur = inventoryPathnameKey(currentPath)
  const list = inventoryPathnameKey(inventoryListPath)
  const prev = previousPath == null ? "" : inventoryPathnameKey(previousPath)
  if (!prev || prev === cur) return false
  if (cur !== list) return false
  return prev.includes("/add-stock")
}
