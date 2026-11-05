/**
 * Client-safe Ghana payout destination normalisation.
 *
 * Kept free of Node-only imports so the employee payment-method form and the
 * server destination resolver share the same rules.
 */

const MOMO_PROVIDERS: Record<string, { code: string; label: string }> = {
  mtn: { code: "MTN", label: "MTN Mobile Money" },
  "mtn mobile money": { code: "MTN", label: "MTN Mobile Money" },
  vod: { code: "VOD", label: "Telecel Cash (Vodafone)" },
  vodafone: { code: "VOD", label: "Telecel Cash (Vodafone)" },
  telecel: { code: "VOD", label: "Telecel Cash (Vodafone)" },
  atl: { code: "ATL", label: "AirtelTigo Money" },
  airteltigo: { code: "ATL", label: "AirtelTigo Money" },
  "airtel tigo": { code: "ATL", label: "AirtelTigo Money" },
  tgo: { code: "ATL", label: "AirtelTigo Money" },
}

export function normalizeGhanaMomoProvider(raw: unknown): { code: string; label: string } | null {
  const key = String(raw ?? "").trim().toLowerCase().replace(/[_-]+/g, " ")
  return MOMO_PROVIDERS[key] ?? null
}

/** Ghana local 10-digit form (0XXXXXXXXX); accepts +233 / 233 prefixes. */
export function normalizeGhanaMomoNumber(raw: unknown): string | null {
  let digits = String(raw ?? "").replace(/[^\d+]/g, "")
  if (digits.startsWith("+233")) digits = `0${digits.slice(4)}`
  else if (digits.startsWith("233")) digits = `0${digits.slice(3)}`
  if (!/^0\d{9}$/.test(digits)) return null
  return digits
}

/** Ghana bank account number: 8–20 digits, spaces removed. */
export function normalizeGhanaBankAccountNumber(raw: unknown): string | null {
  const value = String(raw ?? "").replace(/\s+/g, "").trim()
  return /^\d{8,20}$/.test(value) ? value : null
}

export function maskAccountNumber(value: string | null | undefined): string {
  const raw = String(value ?? "").replace(/\s+/g, "")
  if (!raw) return "—"
  if (raw.length <= 4) return `••${raw.slice(-2)}`
  return `${"•".repeat(Math.max(2, raw.length - 4))}${raw.slice(-4)}`
}

export function maskMomoNumber(value: string | null | undefined): string {
  const raw = String(value ?? "").replace(/\s+/g, "")
  if (!raw) return "—"
  return `${raw.slice(0, 3)}•••${raw.slice(-3)}`
}
