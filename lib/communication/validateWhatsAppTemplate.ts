/**
 * Validation for business WhatsApp templates.
 * Required tokens per type, max length, strip HTML.
 */
import type { WhatsAppTemplateType } from "./getBusinessWhatsAppTemplate"

const REQUIRED_TOKENS: Record<WhatsAppTemplateType, string[]> = {
  invoice: ["{{invoice_number}}", "{{public_url}}"],
  estimate: ["{{estimate_number}}", "{{public_url}}"],
  order: ["{{order_number}}", "{{public_url}}"],
}

const MAX_LENGTH = 1000

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, "").trim()
}

export interface ValidateTemplateResult {
  ok: true
  template: string
}
export interface ValidateTemplateError {
  ok: false
  error: string
}

export function validateWhatsAppTemplate(
  template: string,
  type: WhatsAppTemplateType
): ValidateTemplateResult | ValidateTemplateError {
  const cleaned = stripHtml(template)
  if (cleaned.length > MAX_LENGTH) {
    return { ok: false, error: `Template must be at most ${MAX_LENGTH} characters.` }
  }
  const required = REQUIRED_TOKENS[type]
  for (const token of required) {
    if (!cleaned.includes(token)) {
      return {
        ok: false,
        error: `Template must contain ${token}.`,
      }
    }
  }
  return { ok: true, template: cleaned }
}
