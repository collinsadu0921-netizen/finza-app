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
    if (buffer.length === 0 || buffer.length > 12 * 1024 * 1024) return undefined
    return `data:${mime};base64,${buffer.toString("base64")}`
  } catch {
    return undefined
  }
}
