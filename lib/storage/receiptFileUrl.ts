export function receiptFileKind(pathOrUrl: string | null | undefined): "image" | "pdf" | "file" {
  const value = (pathOrUrl || "").split("?")[0].split("#")[0].toLowerCase()
  if (/\.(jpe?g|png|gif|webp)$/.test(value)) return "image"
  if (value.endsWith(".pdf")) return "pdf"
  return "file"
}

/** Public receipts-bucket URL. Full URLs are kept. Storage paths are not shown raw. */
export function receiptPublicUrl(pathOrUrl: string | null | undefined): string | null {
  const value = pathOrUrl?.trim() || ""
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "")
  if (!base) return null
  const encoded = value
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/")
  return `${base}/storage/v1/object/public/receipts/${encoded}`
}
