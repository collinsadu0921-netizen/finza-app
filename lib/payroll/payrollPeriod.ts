import { createHash } from "crypto"

/** Server-side SHA-256 fingerprint for included staff scope (duplicate guard). */
export function computeStaffScopeFingerprint(staffIds: string[]): string {
  const normalized = [...new Set(staffIds.map((id) => String(id).trim()).filter(Boolean))].sort()
  return createHash("sha256").update(normalized.join(",")).digest("hex")
}
