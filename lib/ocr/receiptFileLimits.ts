import { MAX_IMAGE_BYTES, MAX_PDF_BYTES } from "@/lib/ocr/constants"

export type ReceiptFileKind = "jpeg" | "png" | "webp" | "pdf"

export type ReceiptFileCheck =
  | { ok: true; kind: ReceiptFileKind; mime: string }
  | { ok: false; code: "OCR_UNSUPPORTED_TYPE" | "OCR_MIME_MISMATCH" | "OCR_FILE_TOO_LARGE" }

const MIME_BY_KIND: Record<ReceiptFileKind, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
}

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".")
  return i >= 0 ? name.slice(i).toLowerCase() : ""
}

function kindFromExtension(ext: string): ReceiptFileKind | null {
  if (ext === ".jpg" || ext === ".jpeg") return "jpeg"
  if (ext === ".png") return "png"
  if (ext === ".webp") return "webp"
  if (ext === ".pdf") return "pdf"
  return null
}

function kindFromMime(mime: string): ReceiptFileKind | null {
  const normalized = mime.toLowerCase().split(";")[0]?.trim() ?? ""
  if (normalized === "image/jpg" || normalized === "image/jpeg" || normalized === "image/pjpeg") return "jpeg"
  if (normalized === "image/png") return "png"
  if (normalized === "image/webp") return "webp"
  if (normalized === "application/pdf") return "pdf"
  return null
}

export function checkReceiptFile(file: { name: string; type: string; size: number }): ReceiptFileCheck {
  const extKind = kindFromExtension(extensionOf(file.name))
  const mimeKind = file.type ? kindFromMime(file.type) : null

  if (file.type && !mimeKind) {
    return { ok: false, code: "OCR_UNSUPPORTED_TYPE" }
  }
  if (extKind && mimeKind && extKind !== mimeKind) {
    return { ok: false, code: "OCR_MIME_MISMATCH" }
  }
  const kind = mimeKind ?? extKind
  if (!kind) return { ok: false, code: "OCR_UNSUPPORTED_TYPE" }

  const limit = kind === "pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > limit) {
    return { ok: false, code: "OCR_FILE_TOO_LARGE" }
  }
  return { ok: true, kind, mime: MIME_BY_KIND[kind] }
}
