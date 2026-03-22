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

const DEFAULT_INVOICE_TEMPLATE = `Hi {{customer_name}} 👋,

You have a new invoice from *{{business_name}}*:

🧾 Invoice {{invoice_number}}
💰 Amount Due: {{currency}}{{total}}
📅 Payment Terms: {{due_date}}

View your invoice here:
{{public_url}}

💳 Pay online:
{{pay_url}}

Thank you for your business! Please reach out if you have any questions.`

const DEFAULT_ESTIMATE_TEMPLATE = `Hi {{customer_name}} 👋,

Here is your estimate from *{{business_name}}*:

📋 Estimate {{estimate_number}}
💰 Total Amount: {{currency}}{{total}}
📅 Valid Until: {{valid_until}}

View your estimate here:
{{public_url}}

Please review and let us know if you'd like to proceed or have any questions. We're happy to help!`

const DEFAULT_ORDER_TEMPLATE = `Hi {{customer_name}} 👋,

Thank you for your order with *{{business_name}}*!

📦 Order {{order_number}}
💰 Total Amount: {{currency}}{{total}}

View your order details here:
{{public_url}}

We'll send your invoice once everything is ready. Thank you for choosing us!`

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
