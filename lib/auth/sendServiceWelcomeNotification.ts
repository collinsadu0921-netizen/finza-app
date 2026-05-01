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

/** Customer-facing welcome subject (Finza Service provisioning). */
export const SERVICE_WELCOME_EMAIL_SUBJECT = "Welcome to Finza Service — your workspace is ready"

const WELCOME_PREHEADER =
  "Start creating quotes, invoices, receipts, and tracking payments from one workspace."

function shouldShowNamedWorkspace(businessNameTrimmed: string): boolean {
  if (!businessNameTrimmed) return false
  const lower = businessNameTrimmed.toLowerCase()
  if (lower === "finza" || lower === "finza service") return false
  return true
}

function buildWelcomeEmail(opts: {
  businessName: string
  showNamedWorkspace: boolean
  dashboardUrl: string
  subscriptionUrl: string
  supportEmail: string
}): { html: string; text: string } {
  const dash = escapeHtml(opts.dashboardUrl)
  const sub = escapeHtml(opts.subscriptionUrl)
  const sup = escapeHtml(opts.supportEmail)
  const bizEsc = opts.showNamedWorkspace ? escapeHtml(opts.businessName) : ""

  const introLead = opts.showNamedWorkspace
    ? `Your workspace for ${opts.businessName} is ready.`
    : "Your workspace is ready."
  const introRest =
    " You can now manage quotes, invoices, receipts, customers, and payment records from one place."

  const checklistText = [
    "Complete your business profile",
    "Add your bank and Mobile Money payment details",
    "Create your first quote or invoice",
    "Send documents by email or WhatsApp",
    "Track pending and paid invoices",
  ]

  const text = [
    `${introLead}${introRest}`,
    ``,
    `Start with these steps:`,
    ...checklistText.map((l, i) => `${i + 1}. ${l}`),
    ``,
    `Open your Service dashboard: ${opts.dashboardUrl}`,
    ``,
    `Manage subscription & billing: ${opts.subscriptionUrl}`,
    ``,
    `Need help? ${opts.supportEmail}`,
    ``,
    `— Finza`,
    ``,
    `Finza helps you keep clearer business records. Tax and compliance decisions remain the responsibility of the business and its advisers.`,
  ].join("\n")

  const checklistHtml = checklistText
    .map(
      (line, i) =>
        `<tr><td style="padding:6px 0;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.5;color:#1e293b"><span style="font-weight:700;color:#0f766e;margin-right:6px">${i + 1}.</span>${escapeHtml(line)}</td></tr>`
    )
    .join("")

  const introHtml = opts.showNamedWorkspace
    ? `<p style="margin:0 0 24px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.65;color:#334155;"><span style="color:#0f172a;font-weight:600">Your workspace for <strong style="color:#0f172a">${bizEsc}</strong> is ready.</span>${escapeHtml(introRest)}</p>`
    : `<p style="margin:0 0 24px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.65;color:#334155;"><span style="color:#0f172a;font-weight:600">Your workspace is ready.</span>${escapeHtml(introRest)}</p>`

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(SERVICE_WELCOME_EMAIL_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background-color:#e2e8f0;">
<!-- Preheader (hidden in inbox preview clients that support it) -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:transparent;width:0;height:0;opacity:0;">
  ${escapeHtml(WELCOME_PREHEADER)}
</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#e2e8f0;">
  <tr>
    <td align="center" style="padding:24px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f766e 0%,#059669 100%);padding:28px 24px;text-align:center;">
            <p style="margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.9);">Finza</p>
            <p style="margin:8px 0 0;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:22px;font-weight:700;color:#ffffff;line-height:1.25;">Finza Service</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 28px 24px;">
            <h1 style="margin:0 0 12px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:24px;font-weight:700;color:#0f172a;line-height:1.3;">Welcome to Finza Service</h1>
            ${introHtml}
            <p style="margin:0 0 10px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;font-weight:600;color:#0f172a;">Start with these steps:</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;">${checklistHtml}</table>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 20px;">
              <tr>
                <td align="center" style="border-radius:10px;background:linear-gradient(135deg,#0d9488 0%,#059669 100%);">
                  <a href="${dash}" style="display:inline-block;padding:14px 28px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">Open your Service dashboard</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 24px;text-align:center;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.5;">
              <a href="${sub}" style="color:#0d9488;font-weight:600;text-decoration:underline;">Manage subscription &amp; billing</a>
            </p>
            <p style="margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.55;color:#334155;">Need help? <a href="mailto:${sup}" style="color:#0d9488;font-weight:600;">${sup}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px 28px;">
            <p style="margin:0;padding-top:20px;border-top:1px solid #e2e8f0;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;line-height:1.5;color:#64748b;">Finza helps you keep clearer business records. Tax and compliance decisions remain the responsibility of the business and its advisers.</p>
            <p style="margin:12px 0 0;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;color:#94a3b8;">© ${new Date().getFullYear()} Finza</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
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
    const rawBusinessName = typeof business.name === "string" ? business.name.trim() : ""
    const businessName = rawBusinessName || "your workspace"
    const showNamedWorkspace = shouldShowNamedWorkspace(rawBusinessName)

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
          businessName: rawBusinessName || businessName,
          showNamedWorkspace,
          dashboardUrl,
          subscriptionUrl,
          supportEmail,
        })
        const sendResult = await sendTransactionalEmail({
          to: tenantTo,
          subject: SERVICE_WELCOME_EMAIL_SUBJECT,
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
