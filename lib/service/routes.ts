/**
 * Service workspace route builder for client-scoped links.
 * Use for sidebar and post-submit navigation when industry is service and user is not a firm accountant.
 */

export function buildServiceRoute(path: string, businessId?: string | null): string {
  if (!businessId) return path
  const separator = path.includes("?") ? "&" : "?"
  return `${path}${separator}business_id=${businessId}`
}
