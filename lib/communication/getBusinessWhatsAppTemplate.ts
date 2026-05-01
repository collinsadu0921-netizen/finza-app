/**
 * Fetch business WhatsApp template by type. Falls back to system default if none saved.
 * Never returns null.
 *
 * Default templates omit monetary amounts; recipients see figures only after opening the link.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

export type WhatsAppTemplateType = "invoice" | "estimate" | "order"

/**
 * Placeholders substituted when sending. Legacy keys (total, currency, pay_url, valid_until)
 * remain supported for businesses that saved older templates.
 *
 * Invoice: when messages are built in-app, `pay_url` is set to the same URL as `public_url`
 * (the public invoice link `/invoice-public/{public_token}`), not a raw `/pay/{invoiceId}` link.
 */
export const TEMPLATE_VARIABLES: Record<WhatsAppTemplateType, string[]> = {
  invoice: [
    "customer_name",
    "invoice_number",
    "due_date",
    "public_url",
    "business_name",
    "total",
    "currency",
    "pay_url",
  ],
  estimate: [
    "customer_name",
    "estimate_number",
    "public_url",
    "business_name",
    "total",
    "currency",
    "valid_until",
  ],
  order: [
    "customer_name",
    "order_number",
    "public_url",
    "business_name",
    "total",
    "currency",
  ],
}

const DEFAULT_INVOICE_TEMPLATE = `Hello {{customer_name}},

Your invoice {{invoice_number}} from {{business_name}} is ready.

Due date: {{due_date}}

View invoice:
{{public_url}}

Thank you,
{{business_name}}`

const DEFAULT_ESTIMATE_TEMPLATE = `Hello {{customer_name}},

Your estimate {{estimate_number}} from {{business_name}} is ready.

View estimate:
{{public_url}}

Please review it and let us know if you would like to proceed.

Thank you,
{{business_name}}`

const DEFAULT_ORDER_TEMPLATE = `Hello {{customer_name}},

Your order {{order_number}} from {{business_name}} is ready.

View order:
{{public_url}}

Thank you,
{{business_name}}`

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
