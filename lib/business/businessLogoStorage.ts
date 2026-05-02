/**
 * If `publicUrl` is a Supabase public URL for `business-assets` under
 * `business-logos/{businessId}/…`, returns the storage object path; otherwise null.
 * Never matches external or signed URLs unless they follow the same path shape.
 */
export function tryBusinessAssetsLogoStoragePath(publicUrl: string, businessId: string): string | null {
  const trimmed = publicUrl.trim()
  if (!trimmed || !businessId.trim()) return null
  try {
    const u = new URL(trimmed)
    const marker = "/storage/v1/object/public/business-assets/"
    const idx = u.pathname.indexOf(marker)
    if (idx === -1) return null
    const path = decodeURIComponent(u.pathname.slice(idx + marker.length))
    const prefix = `business-logos/${businessId}/`
    if (!path.startsWith(prefix)) return null
    return path
  } catch {
    return null
  }
}
