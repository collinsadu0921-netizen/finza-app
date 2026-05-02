/** Dispatched after business logo (or branding) changes so the sidebar can refresh without a full reload. */
export const BUSINESS_BRANDING_UPDATED_EVENT = "finza:business-branding-updated"

export type BusinessBrandingUpdatedDetail = {
  businessId: string
  logo_url: string | null
}

export function dispatchBusinessBrandingUpdated(detail: BusinessBrandingUpdatedDetail): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(BUSINESS_BRANDING_UPDATED_EVENT, { detail }))
}
