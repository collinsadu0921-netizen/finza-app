/**
 * Service workspace welcome + internal customer-success emails after provisioning.
 * Uses tenant_notification_events for dedupe. Never throws; safe to void from API routes.
 */
import "server-only"

import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"

const WELCOME_LIFECYCLE_KEY = "service_welcome_v1"
const INTERNAL_ALERT_LIFECYCLE_KEY = "service_signup_internal_alert_v1"

function serviceAppOrigin(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "")
  if (u) return u
  const v = process.env.VERCEL_URL?.trim()
  if (v) return v.startsWith("http") ? v.replace(/\/$/, "") : `https://${v}`
  return "https://app.finza.africa"
}

function looksLikeEmail(s: string | null | undefined): boolean {
  if (!s?.trim()) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
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

/** Public support line shown in welcome email. */
export function resolveFinzaSupportEmailForWelcome(): string {
  const fromEnv =
    process.env.FINZA_SUPPORT_EMAIL?.trim() ||
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() ||
    ""
  if (looksLikeEmail(fromEnv)) return fromEnv
  return "support@finza.africa"
}

/**
 * Primary: FINZA_CUSTOMER_SUCCESS_EMAIL.
 * Fallback: first valid email from INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS (comma-separated).
 */
export function resolveInternalCustomerSuccessRecipient(): string | null {
  const direct = process.env.FINZA_CUSTOMER_SUCCESS_EMAIL?.trim()
  /** Narrow to `string`: `looksLikeEmail` implies non-empty trimmed; `direct` alone is still `string | undefined` for TS. */
  if (direct && looksLikeEmail(direct)) return direct

  const raw = process.env.INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS?.trim()
  if (!raw) return null
  for (const part of raw.split(",")) {
    const e = part.trim().toLowerCase()
    if (looksLikeEmail(e)) return part.trim()
  }
  return null
}

type BusinessRow = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  service_subscription_tier: string | null
  service_subscription_status: string | null
  trial_ends_at: string | null
  created_at: string | null
}

async function hasTenantNotificationDedupe(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: string,
  eventType: string,
  lifecycleKey: string,
  recipientEmail: string
): Promise<boolean> {
  const { data } = await admin
    .from("tenant_notification_events")
    .select("id")
    .eq("business_id", businessId)
    .eq("event_type", eventType)
    .eq("lifecycle_key", lifecycleKey)
    .eq("recipient_email", recipientEmail)
    .maybeSingle()
  return !!data?.id
}

async function insertTenantNotificationLog(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  row: {
    business_id: string
    event_type: string
    lifecycle_key: string
    recipient_email: string
    provider_message_id: string | null
    status: "sent" | "failed"
    error_message: string | null
  }
): Promise<{ duplicate: boolean; error?: string }> {
  const { error } = await admin.from("tenant_notification_events").insert({
    business_id: row.business_id,
    event_type: row.event_type,
    lifecycle_key: row.lifecycle_key,
    recipient_email: row.recipient_email,
    provider: "resend",
    provider_message_id: row.provider_message_id,
    status: row.status,
    error_message: row.error_message,
    sent_at: new Date().toISOString(),
  })
  if (error?.code === "23505") return { duplicate: true }
  if (error) return { duplicate: false, error: error.message }
  return { duplicate: false }
}

function buildWelcomeEmail(opts: {
  businessName: string
  dashboardUrl: string
  subscriptionUrl: string
  supportEmail: string
}): { html: string; text: string } {
  const name = escapeHtml(opts.businessName)
  const dash = escapeHtml(opts.dashboardUrl)
  const sub = escapeHtml(opts.subscriptionUrl)
  const sup = escapeHtml(opts.supportEmail)

  const text = [
    `Hi,`,
    ``,
    `Thank you for signing up for Finza Service for ${opts.businessName}.`,
    ``,
    `Finza Service helps Ghanaian service businesses create quotes and invoices, send receipts, track payments, and keep day-to-day records clearer — without overpromising legal or tax outcomes.`,
    ``,
    `Open your workspace: ${opts.dashboardUrl}`,
    `Subscription & billing: ${opts.subscriptionUrl}`,
    ``,
    `Questions? Contact us at ${opts.supportEmail}.`,
    ``,
    `— Finza`,
  ].join("\n")

  const html = `
<p style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55;color:#111">Hi,</p>
<p style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55;color:#111">Thank you for signing up for <strong>Finza Service</strong> for <strong>${name}</strong>.</p>
<p style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55;color:#111">Finza Service helps Ghanaian service businesses create <strong>quotes</strong>, <strong>invoices</strong>, and <strong>receipts</strong>, track <strong>payments</strong>, and keep business records clearer. We focus on practical tools — we do not guarantee compliance or specific business results.</p>
<p style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55;color:#111">
  <a href="${dash}">Go to your Service dashboard</a><br/>
  <a href="${sub}">Subscription &amp; billing</a>
</p>
<p style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#444">Support: <a href="mailto:${sup}">${sup}</a></p>
<p style="font-family:system-ui,sans-serif;font-size:12px;color:#666">— Finza</p>
`.trim()

  return { html, text }
}

function buildInternalAlertEmail(opts: {
  business: BusinessRow
  ownerEmail: string | null
}): { html: string; text: string } {
  const b = opts.business
  const lines: string[] = [
    `New Finza Service business provisioned`,
    ``,
    `Business name: ${b.name ?? "(unnamed)"}`,
    `Business id: ${b.id}`,
    `Owner email: ${opts.ownerEmail ?? "(none)"}`,
    `Business email: ${b.email ?? "(none)"}`,
    `Phone: ${b.phone ?? "(none)"}`,
    `Subscription tier: ${b.service_subscription_tier ?? "(unset)"}`,
    `Subscription status: ${b.service_subscription_status ?? "(unset)"}`,
    `Trial ends at: ${b.trial_ends_at ?? "(n/a)"}`,
    `Business created_at: ${b.created_at ?? "(n/a)"}`,
    ``,
    `Tenant app: ${serviceAppOrigin()}/service/dashboard`,
  ]
  const text = lines.join("\n")
  const html = `<pre style="font-family:system-ui,monospace;font-size:13px;white-space:pre-wrap">${escapeHtml(
    text
  )}</pre>`
  return { html, text }
}

/**
 * Sends welcome (tenant) and internal customer-success emails once per business / recipient.
 * Safe to fire-and-forget from provision route.
 */
export async function sendServiceWelcomeNotificationsAfterProvision(params: {
  businessId: string
  ownerUserId: string
}): Promise<void> {
  const { businessId, ownerUserId } = params
  try {
    const admin = createSupabaseAdminClient()

    const { data: biz, error: loadErr } = await admin
      .from("businesses")
      .select(
        "id, name, email, phone, service_subscription_tier, service_subscription_status, trial_ends_at, created_at"
      )
      .eq("id", businessId)
      .is("archived_at", null)
      .maybeSingle()

    if (loadErr || !biz) {
      console.warn("[serviceWelcome] business not found", businessId, loadErr?.message)
      return
    }

    const business = biz as BusinessRow
    const businessName =
      typeof business.name === "string" && business.name.trim() ? business.name.trim() : "your workspace"

    let ownerEmail: string | null = null
    const { data: ownerAuth, error: authErr } = await admin.auth.admin.getUserById(ownerUserId)
    if (!authErr && looksLikeEmail(ownerAuth.user?.email)) {
      ownerEmail = String(ownerAuth.user!.email).trim()
    }

    const businessEmail = looksLikeEmail(business.email) ? String(business.email).trim() : null
    const tenantTo = ownerEmail ?? businessEmail

    const origin = serviceAppOrigin()
    const dashboardUrl = `${origin}/service/dashboard`
    const subscriptionUrl = `${origin}/service/settings/subscription`
    const supportEmail = resolveFinzaSupportEmailForWelcome()

    if (tenantTo) {
      const dupWelcome = await hasTenantNotificationDedupe(
        admin,
        businessId,
        "service_welcome",
        WELCOME_LIFECYCLE_KEY,
        tenantTo
      )
      if (!dupWelcome) {
        const { html, text } = buildWelcomeEmail({
          businessName,
          dashboardUrl,
          subscriptionUrl,
          supportEmail,
        })
        const sendResult = await sendTransactionalEmail({
          to: tenantTo,
          subject: "Welcome to Finza Service",
          html,
          text,
          finza: { businessId, documentType: "trial", workspace: "service" },
        })
        const sentOk = sendResult.success === true
        const ins = await insertTenantNotificationLog(admin, {
          business_id: businessId,
          event_type: "service_welcome",
          lifecycle_key: WELCOME_LIFECYCLE_KEY,
          recipient_email: tenantTo,
          provider_message_id: sentOk ? sendResult.id : null,
          status: sentOk ? "sent" : "failed",
          error_message: sentOk ? null : ("reason" in sendResult ? sendResult.reason : "send_failed"),
        })
        if (ins.error && !ins.duplicate) {
          console.error("[serviceWelcome] log insert failed", ins.error)
        }
        if (!sentOk) {
          console.error("[serviceWelcome] welcome email failed", sendResult)
        }
      }
    } else {
      console.warn("[serviceWelcome] no owner or business email for welcome", businessId)
    }

    const internalTo = resolveInternalCustomerSuccessRecipient()
    if (!internalTo) {
      console.warn(
        "[serviceWelcome] no internal recipient (set FINZA_CUSTOMER_SUCCESS_EMAIL or INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS)"
      )
      return
    }

    const dupInternal = await hasTenantNotificationDedupe(
      admin,
      businessId,
      "service_signup_internal_alert",
      INTERNAL_ALERT_LIFECYCLE_KEY,
      internalTo
    )
    if (dupInternal) return

    const { html: intHtml, text: intText } = buildInternalAlertEmail({ business, ownerEmail })
    const intSend = await sendTransactionalEmail({
      to: internalTo,
      subject: "New Finza Service signup",
      html: intHtml,
      text: intText,
      finza: { businessId, documentType: "trial", workspace: "service" },
    })
    const intOk = intSend.success === true
    const intIns = await insertTenantNotificationLog(admin, {
      business_id: businessId,
      event_type: "service_signup_internal_alert",
      lifecycle_key: INTERNAL_ALERT_LIFECYCLE_KEY,
      recipient_email: internalTo,
      provider_message_id: intOk ? intSend.id : null,
      status: intOk ? "sent" : "failed",
      error_message: intOk ? null : ("reason" in intSend ? intSend.reason : "send_failed"),
    })
    if (intIns.error && !intIns.duplicate) {
      console.error("[serviceWelcome] internal log insert failed", intIns.error)
    }
    if (!intOk) {
      console.error("[serviceWelcome] internal alert email failed", intSend)
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[serviceWelcome] unexpected error", businessId, msg)
  }
}
