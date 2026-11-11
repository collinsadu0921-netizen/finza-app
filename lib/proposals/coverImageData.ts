import type { SupabaseClient } from "@supabase/supabase-js"

const MAX_COVER_BYTES = 12 * 1024 * 1024

function dataUriForImage(buffer: Buffer, mime: string): string | undefined {
  if (buffer.length === 0 || buffer.length > MAX_COVER_BYTES) return undefined
  if (!mime.startsWith("image/")) return undefined
  return `data:${mime};base64,${buffer.toString("base64")}`
}

/**
 * Fetch a proposal cover image server-side and return a data URI for PDF HTML.
 * Cover art is the one PDF image that is painted as a CSS background, so making
 * it self-contained avoids network/CORS/loading differences in Chromium.
 */
export async function fetchCoverImageDataUri(
  url: string | null | undefined
): Promise<string | undefined> {
  const value = String(url ?? "").trim()
  if (!/^https?:\/\//i.test(value)) return undefined
  try {
    const response = await fetch(value, { cache: "no-store" })
    if (!response.ok) return undefined
    const mime = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase()
    if (!mime.startsWith("image/")) return undefined
    const buffer = Buffer.from(await response.arrayBuffer())
    return dataUriForImage(buffer, mime)
  } catch {
    return undefined
  }
}

/**
 * Load an authorised proposal cover asset directly from storage for public PDF
 * exports. Public readers use same-origin `/api/...` asset URLs, which cannot
 * resolve inside Chromium's `setContent`; downloading the row's storage path
 * with the service-role client avoids that while preserving the asset gate the
 * render model already applied.
 */
export async function fetchStoredCoverImageDataUri(
  admin: SupabaseClient,
  asset: { storage_path?: string | null; mime_type?: string | null } | null | undefined
): Promise<string | undefined> {
  const path = String(asset?.storage_path ?? "").trim()
  const mime = String(asset?.mime_type ?? "").trim().toLowerCase()
  if (!path || !mime.startsWith("image/")) return undefined
  try {
    const { data, error } = await admin.storage.from("proposal-assets").download(path)
    if (error || !data) return undefined
    const buffer = Buffer.from(await data.arrayBuffer())
    return dataUriForImage(buffer, mime)
  } catch {
    return undefined
  }
}
