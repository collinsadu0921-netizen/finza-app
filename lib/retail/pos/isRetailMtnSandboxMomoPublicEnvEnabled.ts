/**
 * Reads `NEXT_PUBLIC_RETAIL_MTN_SANDBOX_MOMO` (inlined in the client bundle).
 * Accepts common truthy spellings so checkout is not accidentally left on the
 * legacy "Complete sale" path when `.env` uses `true` instead of `1`.
 */
export function isRetailMtnSandboxMomoPublicEnvEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_RETAIL_MTN_SANDBOX_MOMO
  if (raw == null || String(raw).trim() === "") return false
  const v = String(raw).trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes" || v === "on"
}
