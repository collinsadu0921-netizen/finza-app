/**
 * Fetch business WhatsApp template by type. Falls back to system default if none saved.
 * Never returns null.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

export type WhatsAppTemplateType = "invoice" | "estimate" | "order"

/** Variable names available per template type (for settings UI) */
export const TEMPLATE_VARIABLES: Record<WhatsAppTemplateType, string[]> = {
  invoice: ["customer_name", "invoice_number", "total", "currency", "due_date", "public_url", "pay_url", "business_name"],
  estimate: ["customer_name", "estimate_number", "total", "currency", "valid_until", "public_url", "business_name"],
  order: ["customer_name", "order_number", "total", "currency", "public_url", "business_name"],
}

const DEFAULT_INVOICE_TEMPLATE = `Hello {{customer_name}},

Your invoice {{invoice_number}} for {{currency}}{{total}} is ready.

View invoice: {{public_url}}

💳 Pay Now: {{pay_url}}

Payment Terms: {{due_date}}

Thank you for your business!`

const DEFAULT_ESTIMATE_TEMPLATE = `Hello {{customer_name}},

We're pleased to share your estimate from {{business_name}}:

📋 Estimate #{{estimate_number}}
💰 Total Amount: {{currency}}{{total}}
📅 Valid Until: {{valid_until}}

View full estimate: {{public_url}}

Please review and let us know if you have any questions.

Thank you!`

const DEFAULT_ORDER_TEMPLATE = `Hello {{customer_name}},

We're pleased to confirm your order from {{business_name}}:

📋 Order #{{order_number}}
💰 Total Amount: {{currency}}{{total}}

View full order: {{public_url}}

This is a confirmation of your order. An invoice will be sent separately upon completion.

Thank you for your business!`

const DEFAULTS: Record<WhatsAppTemplateType, string> = {
  invoice: DEFAULT_INVOICE_TEMPLATE,
  estimate: DEFAULT_ESTIMATE_TEMPLATE,
  order: DEFAULT_ORDER_TEMPLATE,
}

export async function getBusinessWhatsAppTemplate(
  supabase: SupabaseClient,
  businessId: string,
  type: WhatsAppTemplateType
): Promise<string> {
  const { data } = await supabase
    .from("business_whatsapp_templates")
    .select("template")
    .eq("business_id", businessId)
    .eq("type", type)
    .maybeSingle()

  if (data?.template && typeof data.template === "string") {
    return data.template
  }
  return DEFAULTS[type]
}
