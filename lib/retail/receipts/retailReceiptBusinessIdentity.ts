/**
 * Pure helpers for tenant business identity on retail receipts.
 * Only formats fields that exist — never invents phone, address, or returns policy.
 */

export type RetailReceiptBusinessIdentityFields = {
  address_street?: string | null
  address_city?: string | null
  address_region?: string | null
  address_country?: string | null
  phone?: string | null
  whatsapp_phone?: string | null
  email?: string | null
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const t = value.trim()
  return t.length > 0 ? t : null
}

/** Non-empty address lines from stored business fields, in print order. */
export function formatRetailReceiptAddressLines(
  fields: RetailReceiptBusinessIdentityFields | null | undefined
): string[] {
  if (!fields) return []
  const lines: string[] = []
  const street = clean(fields.address_street)
  if (street) lines.push(street)

  const cityParts = [clean(fields.address_city), clean(fields.address_region)].filter(
    (x): x is string => Boolean(x)
  )
  if (cityParts.length > 0) lines.push(cityParts.join(", "))

  const country = clean(fields.address_country)
  if (country) lines.push(country)
  return lines
}

/** Multi-line address block for ReceiptData.businessLocation, or undefined if none. */
export function formatRetailReceiptAddressBlock(
  fields: RetailReceiptBusinessIdentityFields | null | undefined
): string | undefined {
  const lines = formatRetailReceiptAddressLines(fields)
  return lines.length > 0 ? lines.join("\n") : undefined
}

/** Prefer business phone; fall back to WhatsApp number if phone empty. */
export function pickRetailReceiptBusinessPhone(
  fields: RetailReceiptBusinessIdentityFields | null | undefined
): string | undefined {
  if (!fields) return undefined
  return clean(fields.phone) || clean(fields.whatsapp_phone) || undefined
}

export function pickRetailReceiptBusinessEmail(
  fields: RetailReceiptBusinessIdentityFields | null | undefined
): string | undefined {
  if (!fields) return undefined
  return clean(fields.email) || undefined
}

/**
 * Wrap a single logical line to thermal column width without inventing text.
 * Words longer than width are hard-split.
 */
export function wrapRetailReceiptTextLine(text: string, width: number): string[] {
  const w = Math.max(8, Math.floor(width))
  const raw = text.replace(/\s+/g, " ").trim()
  if (!raw) return []
  if (raw.length <= w) return [raw]
  const words = raw.split(" ")
  const out: string[] = []
  let cur = ""
  for (const word of words) {
    if (word.length > w) {
      if (cur) {
        out.push(cur)
        cur = ""
      }
      for (let i = 0; i < word.length; i += w) {
        out.push(word.slice(i, i + w))
      }
      continue
    }
    const next = cur ? `${cur} ${word}` : word
    if (next.length <= w) {
      cur = next
    } else {
      if (cur) out.push(cur)
      cur = word
    }
  }
  if (cur) out.push(cur)
  return out
}

export function wrapRetailReceiptMultiline(text: string, width: number): string[] {
  const lines: string[] = []
  for (const part of text.split("\n")) {
    const wrapped = wrapRetailReceiptTextLine(part, width)
    if (wrapped.length === 0) continue
    lines.push(...wrapped)
  }
  return lines
}
