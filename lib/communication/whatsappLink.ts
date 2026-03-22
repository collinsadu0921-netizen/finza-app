/**
 * Shared WhatsApp deep-link helper.
 * Normalizes phone for wa.me (digits only), builds URL with encoded message.
 * Use for all "Send via WhatsApp" flows (invoice, estimate, credit note, receipt, etc.).
 */

const DEFAULT_COUNTRY_CODE = "233"
const MIN_DIGITS = 8

export type WhatsAppLinkResult =
  | { ok: true; whatsappUrl: string; digits: string }
  | { ok: false; error: string }

/**
 * Normalize phone for wa.me: digits only (no + or spaces).
 * Leading 0 → default country code; already with + → strip to digits.
 * Returns digits suitable for https://wa.me/{digits}.
 */
export function normalizePhoneForWaMe(
  phone: string | null | undefined,
  defaultCountryCode: string = DEFAULT_COUNTRY_CODE
): { ok: true; digits: string } | { ok: false; error: string } {
  if (phone == null || typeof phone !== "string") {
    return { ok: false, error: "Phone number is required." }
  }
  const trimmed = phone.trim().replace(/\s+/g, "")
  if (!trimmed) {
    return { ok: false, error: "Phone number is required." }
  }
  let normalized: string
  if (trimmed.startsWith("+")) {
    normalized = trimmed.slice(1).replace(/\D/g, "")
  } else {
    const digitsOnly = trimmed.replace(/\D/g, "")
    // Already international (e.g. 23324… without +) — do not prepend country code again
    if (digitsOnly.startsWith(defaultCountryCode)) {
      normalized = digitsOnly
    } else if (digitsOnly.startsWith("0")) {
      normalized = (defaultCountryCode + digitsOnly.replace(/^0+/, "")).replace(/\D/g, "")
    } else {
      normalized = (defaultCountryCode + digitsOnly).replace(/\D/g, "")
    }
  }
  if (normalized.length < MIN_DIGITS) {
    return { ok: false, error: "Please enter a valid phone number." }
  }
  return { ok: true, digits: normalized }
}

/**
 * Build WhatsApp deep-link URL.
 * - Normalizes phone to digits-only for wa.me.
 * - Encodes message with encodeURIComponent.
 * Returns { ok: true, whatsappUrl, digits } or { ok: false, error }.
 */
export function buildWhatsAppLink(
  phone: string | null | undefined,
  message: string,
  defaultCountryCode?: string
): WhatsAppLinkResult {
  const norm = normalizePhoneForWaMe(phone, defaultCountryCode ?? DEFAULT_COUNTRY_CODE)
  if (!norm.ok) return norm
  const whatsappUrl = `https://wa.me/${norm.digits}?text=${encodeURIComponent(message)}`
  return { ok: true, whatsappUrl, digits: norm.digits }
}
