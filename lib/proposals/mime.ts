export function proposalAssetKindFromMime(mime: string): "image" | "pdf" | "file" {
  const m = mime.trim().toLowerCase()
  if (m === "application/pdf") return "pdf"
  if (m.startsWith("image/")) return "image"
  return "file"
}
