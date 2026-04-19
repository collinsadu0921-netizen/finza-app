/**
 * Retail product tiers — v1 is **two tiers** only.
 *
 * - **counter** (product name **Retail**): Run the shop (POS, catalogue, stock, sales, core admin).
 * - **operations** (product name **Retail Plus**): Retail + suppliers, buy lists / POs, receiving, stock transfers.
 *
 * Billing / `businesses` column wiring can use {@link RetailTierId}. UI and APIs should
 * call {@link retailAdminPathMinimumTier} (and later API guards) so limits stay consistent.
 */

export const RETAIL_TIER_IDS = ["counter", "operations"] as const
export type RetailTierId = (typeof RETAIL_TIER_IDS)[number]

export function retailTierLabel(id: RetailTierId): string {
  switch (id) {
    case "counter":
      return "Retail"
    case "operations":
      return "Retail Plus"
    default:
      return id
  }
}

/** Short copy for pricing tables or upgrade prompts. */
export function retailTierDescription(id: RetailTierId): string {
  switch (id) {
    case "counter":
      return "Point of sale, products, inventory, sales history, stores, registers, staff, receipts, shop expenses, and core reports."
    case "operations":
      return "Everything in Retail, plus suppliers, buy lists and purchase orders, receiving, and stock transfers between stores."
    default:
      return ""
  }
}

/**
 * High-level capability flags (for docs, analytics, or future fine-grained gating).
 * Tier 2 implies all tier-1 flags.
 */
export const RETAIL_FEATURES = [
  "pos",
  "catalog",
  "inventory",
  "sales_history",
  "stores_registers_staff",
  "receipts_vat_reports",
  "shop_expenses",
  "suppliers_and_buy_lists",
  "stock_transfers",
] as const

export type RetailFeatureId = (typeof RETAIL_FEATURES)[number]

/** Features included in the Counter tier (subset of {@link RETAIL_FEATURES}). */
export const RETAIL_COUNTER_FEATURES: ReadonlySet<RetailFeatureId> = new Set([
  "pos",
  "catalog",
  "inventory",
  "sales_history",
  "stores_registers_staff",
  "receipts_vat_reports",
  "shop_expenses",
])

/** Operations tier = Counter + supply chain features. */
export const RETAIL_OPERATIONS_FEATURES: ReadonlySet<RetailFeatureId> = new Set([
  ...RETAIL_COUNTER_FEATURES,
  "suppliers_and_buy_lists",
  "stock_transfers",
])

export function retailFeaturesForTier(tier: RetailTierId): ReadonlySet<RetailFeatureId> {
  return tier === "operations" ? RETAIL_OPERATIONS_FEATURES : RETAIL_COUNTER_FEATURES
}

export function retailTierMeetsMinimum(
  assigned: RetailTierId | null | undefined,
  required: RetailTierId,
): boolean {
  if (!assigned || assigned === "counter") return required === "counter"
  return true // operations satisfies counter + operations
}

/**
 * Retail admin UI paths that require the **operations** tier (supplier + extended stock flow).
 * Paths are normalized: no trailing slash; prefix match for nested routes.
 */
const OPERATIONS_ADMIN_PATH_PREFIXES: readonly string[] = [
  "/retail/admin/suppliers",
  "/retail/admin/purchase-orders",
  "/retail/admin/stock-transfers",
]

/** Lowest tier that may access this pathname under `/retail/admin/*`. Counter-only paths return `counter`. */
export function retailAdminPathMinimumTier(pathname: string): RetailTierId {
  const path = pathname.split("?")[0]?.replace(/\/$/, "") || ""
  for (const prefix of OPERATIONS_ADMIN_PATH_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return "operations"
  }
  return "counter"
}

export function retailPathAllowedForTier(pathname: string, tier: RetailTierId | null | undefined): boolean {
  const required = retailAdminPathMinimumTier(pathname)
  return retailTierMeetsMinimum(tier, required)
}
