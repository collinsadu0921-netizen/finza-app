/**
 * Control Tower list deep-link compatibility for Practice Work.
 * Client detail `/accounting/control-tower/[businessId]` is unchanged.
 */
export function controlTowerListRedirectPath(searchParams: {
  business_id?: string | string[] | null
}): string {
  const raw = searchParams.business_id
  const businessId = Array.isArray(raw) ? raw[0] : raw
  const trimmed = businessId?.trim() ?? ""
  if (trimmed) {
    return `/accounting/work?client=${encodeURIComponent(trimmed)}`
  }
  return "/accounting/work"
}
