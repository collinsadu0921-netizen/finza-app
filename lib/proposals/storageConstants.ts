export const PROPOSAL_ASSETS_BUCKET = "proposal-assets" as const

/** 15 MB — keep aligned with bucket file_size_limit migration */
export const PROPOSAL_ASSET_MAX_BYTES = 15 * 1024 * 1024

export const PROPOSAL_ASSET_ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
])

export function assertAllowedProposalMime(mime: string): void {
  const m = mime.trim().toLowerCase()
  if (!PROPOSAL_ASSET_ALLOWED_MIMES.has(m)) {
    throw new Error(`Unsupported file type: ${mime || "(empty)"}`)
  }
}

export function proposalAssetStoragePath(businessId: string, proposalId: string, assetId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "file"
  return `${businessId}/${proposalId}/${assetId}_${safe}`
}
