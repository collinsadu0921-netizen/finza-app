/**
 * Shrink receipt images before Tesseract — large phone photos are the main cause of
 * slow OCR and serverless timeouts. Output is greyscale JPEG for smaller buffers.
 */

const DEV = process.env.NODE_ENV === "development"

function maxEdgePx(): number {
  const n = Number(process.env.RECEIPT_OCR_MAX_EDGE_PX)
  return Number.isFinite(n) && n >= 800 && n <= 4096 ? n : 1600
}

/**
 * Parse data URL → buffer; returns null if not a data URL.
 */
function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s)
  if (!m) return null
  try {
    return { buffer: Buffer.from(m[2], "base64"), mime: m[1].toLowerCase().split(";")[0].trim() }
  } catch {
    return null
  }
}

export async function downscaleReceiptDataUrlForOcr(dataUrl: string): Promise<string> {
  if (process.env.RECEIPT_OCR_SKIP_DOWNSCALE === "true") {
    return dataUrl
  }
  const parsed = dataUrlToBuffer(dataUrl)
  if (!parsed) return dataUrl

  const { buffer: inputBuf, mime } = parsed
  if (mime === "application/pdf") return dataUrl

  try {
    const sharpMod = await import("sharp")
    const sharp = sharpMod.default
    const meta = await sharp(inputBuf).metadata()
    const w = meta.width ?? 0
    const h = meta.height ?? 0
    const maxDim = Math.max(w, h)
    const edge = maxEdgePx()
    const largeByPixels = maxDim > edge
    const largeByBytes = inputBuf.length > 450_000
    if (!largeByPixels && !largeByBytes) {
      return dataUrl
    }

    const out = await sharp(inputBuf)
      .rotate()
      .resize({
        width: edge,
        height: edge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .greyscale()
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer()

    if (DEV) {
      console.debug(
        "[receipt-ocr] downscale %dx%d %dB -> %dB",
        w,
        h,
        inputBuf.length,
        out.length
      )
    }
    return `data:image/jpeg;base64,${out.toString("base64")}`
  } catch (e) {
    if (DEV) console.debug("[receipt-ocr] downscale failed, using original", e)
    return dataUrl
  }
}
