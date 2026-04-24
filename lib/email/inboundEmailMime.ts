/** MIME types supported for inbound-email → receipt OCR (matches performReceiptOcr fetch rules). */

const SUPPORTED = new Set(["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp"])

function extToMime(ext: string | undefined): string | null {
  if (!ext) return null
  switch (ext.toLowerCase()) {
    case "pdf":
      return "application/pdf"
    case "png":
      return "image/png"
    case "jpg":
    case "jpeg":
      return "image/jpeg"
    case "webp":
      return "image/webp"
    default:
      return null
  }
}

export function inferMimeFromFileName(fileName: string | null | undefined): string | null {
  if (!fileName?.trim()) return null
  const base = fileName.trim().split(/[/\\]/).pop() ?? ""
  const dot = base.lastIndexOf(".")
  if (dot < 0) return null
  return extToMime(base.slice(dot + 1))
}

export function normalizeMime(mime: string | null | undefined): string | null {
  if (!mime?.trim()) return null
  return mime.split(";")[0].trim().toLowerCase()
}

export function isSupportedInboundAttachmentMime(
  contentType: string | null | undefined,
  fileName: string | null | undefined
): boolean {
  const m = normalizeMime(contentType)
  if (m && SUPPORTED.has(m)) return true
  const inferred = inferMimeFromFileName(fileName)
  return !!(inferred && SUPPORTED.has(inferred))
}

export function effectiveMimeForStorage(
  contentType: string | null | undefined,
  fileName: string | null | undefined,
  responseContentType: string | null | undefined
): string {
  const fromResp = normalizeMime(responseContentType)
  if (fromResp && SUPPORTED.has(fromResp)) return fromResp
  const fromMeta = normalizeMime(contentType)
  if (fromMeta && SUPPORTED.has(fromMeta)) return fromMeta
  const inferred = inferMimeFromFileName(fileName)
  if (inferred && SUPPORTED.has(inferred)) return inferred
  return fromMeta ?? fromResp ?? "application/octet-stream"
}
