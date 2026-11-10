export const PROPOSAL_ASSETS_BUCKET = "proposal-assets" as const

/** 15 MB — keep aligned with the bucket file_size_limit migration. */
export const PROPOSAL_ASSET_MAX_BYTES = 15 * 1024 * 1024

/** Reject decompression/decoding bombs before image processing. */
export const PROPOSAL_ASSET_MAX_DIMENSION = 12_000
export const PROPOSAL_ASSET_MAX_PIXELS = 40_000_000

export const PROPOSAL_ASSET_ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
])

export const PROPOSAL_ASSET_EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
}

export function assertAllowedProposalMime(mime: string): void {
  const m = mime.trim().toLowerCase()
  if (!PROPOSAL_ASSET_ALLOWED_MIMES.has(m)) {
    throw new Error(`Unsupported file type: ${mime || "(empty)"}`)
  }
}

export function proposalAssetExtensionForMime(mime: string): string {
  const m = mime.trim().toLowerCase()
  const extension = PROPOSAL_ASSET_EXTENSION_BY_MIME[m]
  if (!extension) throw new Error(`Unsupported file type: ${mime || "(empty)"}`)
  return extension
}

/**
 * Storage paths are server-generated. The client filename is never used in the
 * object path; only the generated asset UUID and a canonical extension are.
 */
export function proposalAssetStoragePath(
  businessId: string,
  proposalId: string,
  assetId: string,
  extension: string
): string {
  const ext = extension.replace(/[^a-z0-9]/gi, "").toLowerCase()
  if (!ext) throw new Error("Storage extension required")
  return `${businessId}/${proposalId}/${assetId}.${ext}`
}

/** True only for a path under this exact business/proposal prefix. */
export function isProposalAssetStoragePath(
  path: string | null | undefined,
  businessId: string,
  proposalId: string
): boolean {
  const value = String(path ?? "").trim()
  if (!value || value !== path) return false
  const prefix = `${businessId}/${proposalId}/`
  if (!value.startsWith(prefix)) return false
  if (value.includes("..")) return false
  const objectName = value.slice(prefix.length)
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(objectName)
}

/** A display-only filename. It never determines the storage path. */
export function sanitizeProposalAssetDisplayName(name: string | null | undefined): string {
  const raw = String(name ?? "").trim()
  const base = raw.split(/[\\/]/).pop() || ""
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim()
  return (cleaned || "file").slice(0, 240)
}
