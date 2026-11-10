import sharp from "sharp"
import {
  PROPOSAL_ASSET_ALLOWED_MIMES,
  PROPOSAL_ASSET_MAX_BYTES,
  PROPOSAL_ASSET_MAX_DIMENSION,
  PROPOSAL_ASSET_MAX_PIXELS,
  assertAllowedProposalMime,
  proposalAssetExtensionForMime,
} from "./storageConstants"

export class ProposalAssetValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProposalAssetValidationError"
  }
}

export type ValidatedProposalAsset = {
  buffer: Buffer
  mimeType: string
  extension: string
  size: number
  width?: number
  height?: number
  /** Images are decoded and re-encoded; PDFs are signature/parse validated only. */
  rewritten: boolean
}

/** Fast magic-byte classification used when serving an existing stored asset. */
export function detectProposalAssetMime(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg"
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer.subarray(1, 4).toString("latin1") === "PNG" &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png"
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp"
  }
  if (buffer.subarray(0, Math.min(buffer.length, 1024)).toString("latin1").includes("%PDF-")) {
    return "application/pdf"
  }
  return null
}

const IMAGE_FORMAT_BY_MIME: Record<string, "jpeg" | "png" | "webp"> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
}

function looksLikePdf(buffer: Buffer): boolean {
  const head = buffer.subarray(0, Math.min(buffer.length, 1024)).toString("latin1")
  const tail = buffer.subarray(Math.max(0, buffer.length - 4096)).toString("latin1")
  return head.includes("%PDF-") && tail.includes("%%EOF")
}

async function validatePdf(buffer: Buffer): Promise<ValidatedProposalAsset> {
  if (!looksLikePdf(buffer)) {
    throw new ProposalAssetValidationError("The PDF file is malformed or truncated.")
  }

  try {
    const pdfParse = require("pdf-parse") as (input: Buffer) => Promise<{ numpages: number }>
    const parsed = await pdfParse(buffer)
    if (!parsed || !Number.isFinite(parsed.numpages) || parsed.numpages <= 0) {
      throw new Error("no pages")
    }
  } catch {
    throw new ProposalAssetValidationError("The PDF file could not be parsed safely.")
  }

  return {
    buffer,
    mimeType: "application/pdf",
    extension: "pdf",
    size: buffer.length,
    rewritten: false,
  }
}

async function validateImage(buffer: Buffer, mimeType: string): Promise<ValidatedProposalAsset> {
  const expectedFormat = IMAGE_FORMAT_BY_MIME[mimeType]
  if (!expectedFormat) {
    throw new ProposalAssetValidationError("Unsupported image type.")
  }

  let metadata: sharp.Metadata
  try {
    metadata = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: PROPOSAL_ASSET_MAX_PIXELS,
      animated: false,
    }).metadata()
  } catch {
    throw new ProposalAssetValidationError("The image file is malformed.")
  }

  if (metadata.format !== expectedFormat) {
    throw new ProposalAssetValidationError(
      `The image content does not match its declared type (${metadata.format || "unknown"}).`
    )
  }

  const width = Number(metadata.width ?? 0)
  const height = Number(metadata.height ?? 0)
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > PROPOSAL_ASSET_MAX_DIMENSION ||
    height > PROPOSAL_ASSET_MAX_DIMENSION ||
    width * height > PROPOSAL_ASSET_MAX_PIXELS
  ) {
    throw new ProposalAssetValidationError("The image dimensions exceed the allowed limit.")
  }

  let pipeline = sharp(buffer, {
    failOn: "error",
    limitInputPixels: PROPOSAL_ASSET_MAX_PIXELS,
    animated: false,
  }).rotate()

  if (mimeType === "image/jpeg") {
    pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true })
  } else if (mimeType === "image/png") {
    pipeline = pipeline.png({ compressionLevel: 9, palette: false })
  } else {
    pipeline = pipeline.webp({ quality: 90, effort: 4 })
  }

  let result: { data: Buffer; info: sharp.OutputInfo }
  try {
    result = await pipeline.toBuffer({ resolveWithObject: true })
  } catch {
    throw new ProposalAssetValidationError("The image content could not be decoded safely.")
  }

  if (!result.data.length || result.data.length > PROPOSAL_ASSET_MAX_BYTES) {
    throw new ProposalAssetValidationError("The processed image exceeds the allowed size.")
  }

  return {
    buffer: result.data,
    mimeType,
    extension: proposalAssetExtensionForMime(mimeType),
    size: result.data.length,
    width: result.info.width,
    height: result.info.height,
    rewritten: true,
  }
}

/**
 * Validate untrusted uploaded bytes before a proposal asset can become public.
 * Declared MIME is only a first filter; image bytes are decoded and re-encoded,
 * and PDFs must have a valid header/EOF and parse as at least one page.
 */
export async function validateProposalAssetContent(input: {
  buffer: Buffer
  declaredMime: string
}): Promise<ValidatedProposalAsset> {
  const mime = input.declaredMime.trim().toLowerCase()
  if (!PROPOSAL_ASSET_ALLOWED_MIMES.has(mime)) {
    throw new ProposalAssetValidationError(`Unsupported file type: ${mime || "(empty)"}`)
  }
  assertAllowedProposalMime(mime)

  const buffer = input.buffer
  if (!buffer.length) {
    throw new ProposalAssetValidationError("The uploaded file is empty.")
  }
  if (buffer.length > PROPOSAL_ASSET_MAX_BYTES) {
    throw new ProposalAssetValidationError(
      `The uploaded file exceeds the ${PROPOSAL_ASSET_MAX_BYTES} byte limit.`
    )
  }

  if (mime === "application/pdf") return validatePdf(buffer)
  return validateImage(buffer, mime)
}
