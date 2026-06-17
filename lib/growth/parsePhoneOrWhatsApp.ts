/**
 * Normalizes a single phone/WhatsApp field into businesses.phone + businesses.whatsapp_phone.
 */

export type ParsedContactPhone = {
  phone: string
  whatsapp_phone: string
}

export function parsePhoneOrWhatsApp(raw: string): ParsedContactPhone | null {
  const trimmed = raw.trim().replace(/\s+/g, " ")
  if (!trimmed) return null

  const digits = trimmed.replace(/\D/g, "")
  if (digits.length < 8) return null

  // Store display-friendly trimmed value; WhatsApp link helper normalizes digits later.
  return {
    phone: trimmed,
    whatsapp_phone: trimmed,
  }
}
