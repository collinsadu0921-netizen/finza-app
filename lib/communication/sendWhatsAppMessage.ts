/**
 * WhatsApp Communication Service
 *
 * Provider-agnostic abstraction for sending WhatsApp messages.
 * Supports Twilio and Meta (Cloud API) compatible providers.
 *
 * Usage: Estimate delivery, Invoice delivery, Payment confirmation.
 * Design: Async delivery queue, retry handling, communication event logging.
 */

export type WhatsAppProvider = "twilio" | "meta" | "mock"

export interface WhatsAppConfig {
  provider: WhatsAppProvider
  /** Twilio: account SID; Meta: app access token */
  accountId?: string
  /** Twilio: auth token; Meta: not used for send */
  authToken?: string
  /** Meta: phone number ID; Twilio: from number (e.g. whatsapp:+14155238886) */
  fromNumberOrId?: string
  /** Webhook verify token (Meta); not used by Twilio send */
  webhookVerifyToken?: string
}

export interface SendWhatsAppMessageInput {
  to: string
  /** E.164 or national format; normalized by provider adapter */
  body: string
  /** Optional: reference for idempotency and logging */
  reference?: string
  /** Optional: business/customer context for audit */
  businessId?: string
  entityType?: "estimate" | "invoice" | "payment"
  entityId?: string
}

export interface SendWhatsAppMessageResult {
  success: boolean
  messageId?: string
  provider?: WhatsAppProvider
  error?: string
  /** For logging / audit */
  reference?: string
}

export interface CommunicationLogEvent {
  at: string
  provider: WhatsAppProvider
  to: string
  reference?: string
  businessId?: string
  entityType?: string
  entityId?: string
  success: boolean
  messageId?: string
  error?: string
}

const defaultConfig = (): WhatsAppConfig => ({
  provider: (process.env.WHATSAPP_PROVIDER as WhatsAppProvider) || "mock",
  accountId: process.env.TWILIO_ACCOUNT_SID ?? process.env.META_APP_ID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  fromNumberOrId: process.env.TWILIO_WHATSAPP_FROM ?? process.env.META_WHATSAPP_PHONE_NUMBER_ID,
  webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN,
})

/** Log communication event (implement persistence via audit table or external logger) */
export function logCommunicationEvent(event: CommunicationLogEvent): void {
  if (process.env.NODE_ENV !== "test") {
    console.info("[communication]", JSON.stringify(event))
  }
}

/** Normalize phone to E.164 for provider (e.g. +233XXXXXXXXX for Ghana) */
export function normalizePhoneForWhatsApp(phone: string, defaultCountryCode = "233"): string {
  const cleaned = phone.replace(/\s+/g, "").replace(/^0/, "")
  if (cleaned.startsWith("+")) return cleaned
  return `+${defaultCountryCode}${cleaned}`
}

/**
 * Send WhatsApp message via configured provider.
 * Uses async queue placeholder: in production, push to queue (e.g. Bull, SQS) and process with retry.
 */
export async function sendWhatsAppMessage(
  input: SendWhatsAppMessageInput,
  config?: Partial<WhatsAppConfig>
): Promise<SendWhatsAppMessageResult> {
  const cfg = { ...defaultConfig(), ...config }
  const toNormalized = normalizePhoneForWhatsApp(input.to)
  const reference = input.reference ?? `wa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

  const logEvent: CommunicationLogEvent = {
    at: new Date().toISOString(),
    provider: cfg.provider,
    to: toNormalized,
    reference,
    businessId: input.businessId,
    entityType: input.entityType,
    entityId: input.entityId,
    success: false,
  }

  try {
    if (cfg.provider === "mock") {
      logEvent.success = true
      logEvent.messageId = `mock-${reference}`
      logCommunicationEvent(logEvent)
      return { success: true, messageId: logEvent.messageId, provider: "mock", reference }
    }

    if (cfg.provider === "twilio") {
      const result = await sendViaTwilio(toNormalized, input.body, cfg, reference)
      logEvent.success = result.success
      logEvent.messageId = result.messageId
      logEvent.error = result.error
      logCommunicationEvent(logEvent)
      return { ...result, reference }
    }

    if (cfg.provider === "meta") {
      const result = await sendViaMeta(toNormalized, input.body, cfg, reference)
      logEvent.success = result.success
      logEvent.messageId = result.messageId
      logEvent.error = result.error
      logCommunicationEvent(logEvent)
      return { ...result, reference }
    }

    logEvent.error = `Unknown provider: ${cfg.provider}`
    logCommunicationEvent(logEvent)
    return { success: false, error: logEvent.error, provider: cfg.provider, reference }
  } catch (err: any) {
    logEvent.error = err?.message ?? String(err)
    logCommunicationEvent(logEvent)
    return {
      success: false,
      error: logEvent.error,
      provider: cfg.provider,
      reference,
    }
  }
}

/** Twilio WhatsApp API (compatible with Twilio WhatsApp sandbox / production) */
async function sendViaTwilio(
  to: string,
  body: string,
  cfg: WhatsAppConfig,
  reference: string
): Promise<SendWhatsAppMessageResult> {
  const accountId = cfg.accountId ?? process.env.TWILIO_ACCOUNT_SID
  const authToken = cfg.authToken ?? process.env.TWILIO_AUTH_TOKEN
  const from = cfg.fromNumberOrId ?? process.env.TWILIO_WHATSAPP_FROM

  if (!accountId || !authToken || !from) {
    return {
      success: false,
      error: "Twilio WhatsApp not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM)",
      provider: "twilio",
    }
  }

  const twilioFrom = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`
  const twilioTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountId}/Messages.json`
  const params = new URLSearchParams({
    To: twilioTo,
    From: twilioFrom,
    Body: body,
  })

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${accountId}:${authToken}`).toString("base64")}`,
    },
    body: params.toString(),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return {
      success: false,
      error: data.message ?? `Twilio HTTP ${res.status}`,
      provider: "twilio",
    }
  }
  return {
    success: true,
    messageId: data.sid,
    provider: "twilio",
  }
}

/** Meta Cloud API WhatsApp (compatible with Meta Business API) */
async function sendViaMeta(
  to: string,
  body: string,
  cfg: WhatsAppConfig,
  _reference: string
): Promise<SendWhatsAppMessageResult> {
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN ?? cfg.authToken
  const phoneNumberId = cfg.fromNumberOrId ?? process.env.META_WHATSAPP_PHONE_NUMBER_ID

  if (!token || !phoneNumberId) {
    return {
      success: false,
      error: "Meta WhatsApp not configured (META_WHATSAPP_ACCESS_TOKEN, META_WHATSAPP_PHONE_NUMBER_ID)",
      provider: "meta",
    }
  }

  const waId = to.replace(/\D/g, "")
  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: waId,
      type: "text",
      text: { body },
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return {
      success: false,
      error: data.error?.message ?? `Meta HTTP ${res.status}`,
      provider: "meta",
    }
  }
  return {
    success: true,
    messageId: data.messages?.[0]?.id,
    provider: "meta",
  }
}

/**
 * Async delivery queue placeholder.
 * In production: push to queue (e.g. Bull, SQS) and worker calls sendWhatsAppMessage with retry policy.
 */
export async function enqueueWhatsAppMessage(
  input: SendWhatsAppMessageInput,
  config?: Partial<WhatsAppConfig>
): Promise<{ enqueued: boolean; reference?: string }> {
  const reference = input.reference ?? `wa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  if (process.env.WHATSAPP_QUEUE_ENABLED === "true") {
    // TODO: Push to queue (e.g. Redis Bull queue) and return reference
    // await whatsAppQueue.add({ ...input, reference }, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } })
    return { enqueued: true, reference }
  }
  const result = await sendWhatsAppMessage({ ...input, reference }, config)
  return { enqueued: false, reference: result.reference }
}
