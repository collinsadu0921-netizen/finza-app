/**
 * Service subscription lifecycle emails (Resend) + dedupe log in subscription_notification_events.
 * Safe for webhooks: never throws; failures are logged and swallowed at the caller via void + catch if desired.
 */
import "server-only"

import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"

export type SubscriptionLifecycleEventType =
  | "payment_failed_grace_started"
  | "grace_ending_24h"
  | "subscription_locked"
  | "subscription_reactivated"
  | "trial_ending_3d"
  | "trial_ending_1d"

export type SendSubscriptionLifecycleNotificationInput = {
  businessId: string
  eventType: SubscriptionLifecycleEventType
  lifecycleKey: string
  metadata?: Record<string, unknown>
}

export type SendSubscriptionLifecycleNotificationResult =
  | { ok: true; skipped: true; reason: "no_recipient" | "duplicate" }
  | { ok: true; skipped?: false; providerMessageId?: string }
  | { ok: false; reason: string }

function serviceAppOrigin(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "")
  if (u) return u
  const v = process.env.VERCEL_URL?.trim()
  if (v) return v.startsWith("http") ? v.replace(/\/$/, "") : `https://${v}`
  return "https://app.finza.africa"
}

function subscriptionSettingsUrl(): string {
  return `${serviceAppOrigin()}/service/settings/subscription`
}

function looksLikeEmail(s: string | null | undefined): boolean {
  if (!s?.trim()) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

function subjectForEvent(eventType: SubscriptionLifecycleEventType): string {
  switch (eventType) {
    case "payment_failed_grace_started":
      return "Your Finza subscription payment failed"
    case "grace_ending_24h":
      return "Reminder: your Finza subscription grace period ends soon"
    case "subscription_locked":
      return "Your Finza workspace subscription is locked"
    case "subscription_reactivated":
      return "Your Finza subscription is active again"
    case "trial_ending_3d":
      return "Your Finza trial ends in 3 days"
    case "trial_ending_1d":
      return "Your Finza trial ends tomorrow"
    default:
      return "Finza subscription update"
  }
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }
  return text.replace(/[&<>"']/g, (m) => map[m])
}

function buildEmailBody(opts: {
  eventType: SubscriptionLifecycleEventType
  businessName: string
  renewUrl: string
}): { html: string; text: string } {
  const { eventType, businessName, renewUrl } = opts
  const name = escapeHtml(businessName)
  const link = escapeHtml(renewUrl)

  let headline = "Subscription update"
  let bodyText = ""
  switch (eventType) {
    case "payment_failed_grace_started":
      headline = "Payment failed — grace period started"
      bodyText = `We could not charge your subscription for ${name}. You have a 3-day grace period to update your payment method. After that, workspace access may be restricted until payment succeeds.`
      break
    case "grace_ending_24h":
      headline = "Grace period ending soon"
      bodyText = `Your payment grace period for ${name} is ending soon. If we do not receive a successful payment, your workspace may be locked.`
      break
    case "subscription_locked":
      headline = "Subscription locked"
      bodyText = `Your Finza workspace for ${name} is locked due to an overdue subscription payment. Renew your subscription to restore full access.`
      break
    case "subscription_reactivated":
      headline = "Subscription active"
      bodyText = `Good news — your Finza subscription for ${name} is active again and you have full workspace access.`
      break
    case "trial_ending_3d":
      headline = "Trial ending in 3 days"
      bodyText = `Your Finza trial for ${name} ends in about three days. Subscribe to keep uninterrupted access to your plan.`
      break
    case "trial_ending_1d":
      headline = "Trial ending tomorrow"
      bodyText = `Your Finza trial for ${name} ends tomorrow. Subscribe now to avoid interruption.`
      break
  }

  const html = `
    <p style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">${escapeHtml(bodyText)}</p>
    <p style="font-family:system-ui,sans-serif;font-size:15px"><a href="${link}">Open subscription &amp; billing</a></p>
    <p style="font-family:system-ui,sans-serif;font-size:12px;color:#666">${escapeHtml(headline)} · Finza</p>
  `.trim()

  const text = `${bodyText}\n\nOpen subscription & billing: ${renewUrl}\n\n${headline} · Finza`
  return { html, text }
}

async function resolveRecipientEmail(
  businessId: string
): Promise<{ email: string; businessName: string } | null> {
  const admin = createSupabaseAdminClient()
  const { data: biz, error } = await admin
    .from("businesses")
    .select("name, email, owner_id")
    .eq("id", businessId)
    .is("archived_at", null)
    .maybeSingle()

  if (error || !biz) {
    console.warn("[subscriptionLifecycleEmail] missing business", businessId, error?.message)
    return null
  }

  const businessName =
    typeof biz.name === "string" && biz.name.trim() ? biz.name.trim() : "Your workspace"

  if (looksLikeEmail(biz.email as string | null)) {
    return { email: String(biz.email).trim(), businessName }
  }

  const ownerId = biz.owner_id as string | null
  if (ownerId) {
    const { data: ownerAuth, error: authErr } = await admin.auth.admin.getUserById(ownerId)
    if (!authErr && looksLikeEmail(ownerAuth.user?.email)) {
      return { email: String(ownerAuth.user!.email).trim(), businessName }
    }
  }

  console.warn("[subscriptionLifecycleEmail] no business.email or owner auth email", businessId)
  return null
}

/**
 * Sends a deduped lifecycle email when appropriate. Does not throw.
 */
export async function sendSubscriptionLifecycleNotification(
  input: SendSubscriptionLifecycleNotificationInput
): Promise<SendSubscriptionLifecycleNotificationResult> {
  const { businessId, eventType, lifecycleKey, metadata } = input

  try {
    const admin = createSupabaseAdminClient()
    const recipient = await resolveRecipientEmail(businessId)
    if (!recipient) {
      return { ok: true, skipped: true, reason: "no_recipient" }
    }

    const { email: recipientEmail, businessName } = recipient

    const { data: dup } = await admin
      .from("subscription_notification_events")
      .select("id")
      .eq("business_id", businessId)
      .eq("event_type", eventType)
      .eq("lifecycle_key", lifecycleKey)
      .eq("recipient_email", recipientEmail)
      .maybeSingle()

    if (dup?.id) {
      return { ok: true, skipped: true, reason: "duplicate" }
    }

    const renewUrl = subscriptionSettingsUrl()
    const { html, text } = buildEmailBody({ eventType, businessName, renewUrl })
    const subject = subjectForEvent(eventType)

    const sendResult = await sendTransactionalEmail({
      to: recipientEmail,
      subject,
      html,
      text,
      finza: { businessId, documentType: "trial", workspace: "service" },
    })

    const sentOk = sendResult.success === true
    const providerMessageId = sentOk ? sendResult.id : null
    const errorMessage = sentOk ? null : ("reason" in sendResult ? sendResult.reason : "send_failed")

    const { error: insErr } = await admin.from("subscription_notification_events").insert({
      business_id: businessId,
      event_type: eventType,
      lifecycle_key: lifecycleKey,
      recipient_email: recipientEmail,
      provider: "resend",
      provider_message_id: providerMessageId,
      status: sentOk ? "sent" : "failed",
      error_message: errorMessage,
      sent_at: new Date().toISOString(),
    })

    if (insErr) {
      if (insErr.code === "23505") {
        return { ok: true, skipped: true, reason: "duplicate" }
      }
      console.error("[subscriptionLifecycleEmail] log insert failed", insErr)
      return { ok: false, reason: insErr.message || "log_insert_failed" }
    }

    if (!sentOk) {
      return { ok: false, reason: errorMessage || "send_failed" }
    }

    if (metadata && Object.keys(metadata).length > 0) {
      // metadata reserved for future template enrichment / cron context
      void metadata
    }

    return { ok: true, providerMessageId: providerMessageId ?? undefined }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[subscriptionLifecycleEmail] unexpected error", msg)
    return { ok: false, reason: msg }
  }
}
