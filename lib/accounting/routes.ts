/**
 * Canonical accounting route builder for client-scoped links.
 * Use for dashboard icon row, control-tower drill links, and any shortcut that
 * must point to /accounting/* with business_id in the URL (no cookies/session).
 */

const CONTROL_TOWER_PATH = "/accounting/control-tower"

function isClientScopedAccountingPath(base: string): boolean {
  if (base === CONTROL_TOWER_PATH || base.startsWith(`${CONTROL_TOWER_PATH}/`)) return false
  return base.startsWith("/accounting/")
}

/**
 * Build canonical accounting URL. Client-scoped paths get business_id when provided;
 * Control Tower never gets business_id. Safely handles existing query params (appends with &).
 * Wave 12: In dev, logs warning when client-scoped route is built without business_id.
 */
export function buildAccountingRoute(path: string, businessId?: string): string {
  const base = path.startsWith("/") ? path : `/accounting/${path.replace(/^\//, "")}`
  if (base === CONTROL_TOWER_PATH || base.startsWith(`${CONTROL_TOWER_PATH}/`)) {
    return base
  }
  if (!businessId) {
    if (typeof process !== "undefined" && process.env.NODE_ENV === "development" && isClientScopedAccountingPath(base)) {
      console.warn("[accounting] Client-scoped route built without business_id — link may show disabled or require context:", base)
    }
    return base
  }
  const hasQuery = base.includes("?")
  return `${base}${hasQuery ? "&" : "?"}business_id=${encodeURIComponent(businessId)}`
}
