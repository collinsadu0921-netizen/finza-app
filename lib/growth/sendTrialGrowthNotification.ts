import "server-only"

import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { signupGoalLabel } from "@/lib/growth/signupGoals"

export type TrialGrowthEmailEventType =
  | "setup_incomplete_24h"
  | "no_activation_24h"
  | "invoice_no_payment_48h"

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

function subjectForEvent(eventType: TrialGrowthEmailEventType): string {
  switch (eventType) {
    case "setup_incomplete_24h":
      return "Finish setting up your Finza Service workspace"
    case "no_activation_24h":
      return "Need help getting started on Finza Service?"
    case "invoice_no_payment_48h":
      return "Record your first payment on Finza"
    default:
      return "Finza Service — quick check-in"
  }
}

function bodyForEvent(
  eventType: TrialGrowthEmailEventType,
  businessName: string,
  signupGoal: string | null
): { html: string; text: string } {
  const origin = serviceAppOrigin()
  const goal = signupGoalLabel(signupGoal)
  const dash = `${origin}/service/dashboard`
  const setup = `${origin}/business-setup`
  const invoices = `${origin}/invoices/new`
  const payments = `${origin}/service/dashboard`

  let text = ""
  switch (eventType) {
    case "setup_incomplete_24h":
      text = `You started creating a Finza Service account but haven't finished business setup yet. Complete setup in a few minutes:\n\n${setup}\n\nWe're here if you need help with onboarding or your trial.`
      break
    case "no_activation_24h":
      text = `Your workspace for ${businessName} is ready. You mentioned you wanted to ${goal.toLowerCase()}.\n\nOpen your dashboard and take the first step:\n${dash}\n\nReply to this email if you'd like a hand getting started.`
      break
    case "invoice_no_payment_48h":
      text = `You've created an invoice for ${businessName} — great start.\n\nWhen payment comes in, record it in Finza so your records stay accurate:\n${payments}\n\nCreate another invoice anytime: ${invoices}`
      break
  }

  const html = `<p style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55;color:#334155">${text.replace(/\n/g, "<br/>")}</p>`
  return { html, text }
}

async function hasTenantNotificationDedupe(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: string | null,
  eventType: string,
  lifecycleKey: string,
  recipientEmail: string
): Promise<boolean> {
  let q = admin
    .from("tenant_notification_events")
    .select("id")
    .eq("event_type", eventType)
    .eq("lifecycle_key", lifecycleKey)
    .eq("recipient_email", recipientEmail)

  if (businessId) {
    q = q.eq("business_id", businessId)
  }

  const { data } = await q.maybeSingle()
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
): Promise<void> {
  await admin.from("tenant_notification_events").insert({
    ...row,
    provider: "resend",
    sent_at: new Date().toISOString(),
  })
}

async function resolveBusinessRecipient(
  businessId: string
): Promise<{ email: string; businessName: string; signupGoal: string | null; consent: boolean } | null> {
  const admin = createSupabaseAdminClient()
  const { data: biz } = await admin
    .from("businesses")
    .select(
      "name, email, owner_id, signup_goal, trial_contact_consent, service_subscription_status, subscription_started_at, industry"
    )
    .eq("id", businessId)
    .is("archived_at", null)
    .maybeSingle()

  if (!biz || biz.industry !== "service") return null

  // Do not nudge paying customers.
  if (biz.subscription_started_at) return null

  if (biz.trial_contact_consent !== true) return null

  const businessName =
    typeof biz.name === "string" && biz.name.trim() ? biz.name.trim() : "your business"

  let email: string | null = looksLikeEmail(biz.email as string | null)
    ? String(biz.email).trim()
    : null

  if (!email && biz.owner_id) {
    const { data: ownerAuth } = await admin.auth.admin.getUserById(String(biz.owner_id))
    if (looksLikeEmail(ownerAuth.user?.email)) {
      email = String(ownerAuth.user!.email).trim()
    }
  }

  if (!email) return null

  return {
    email,
    businessName,
    signupGoal: typeof biz.signup_goal === "string" ? biz.signup_goal : null,
    consent: true,
  }
}

export type SendTrialGrowthEmailInput = {
  businessId: string
  eventType: TrialGrowthEmailEventType
  lifecycleKey: string
}

export type SendTrialGrowthEmailResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; sent: true }
  | { ok: false; reason: string }

export async function sendTrialGrowthEmail(
  input: SendTrialGrowthEmailInput
): Promise<SendTrialGrowthEmailResult> {
  try {
    const admin = createSupabaseAdminClient()
    const recipient = await resolveBusinessRecipient(input.businessId)
    if (!recipient) {
      return { ok: true, skipped: true, reason: "no_eligible_recipient" }
    }

    const dup = await hasTenantNotificationDedupe(
      admin,
      input.businessId,
      input.eventType,
      input.lifecycleKey,
      recipient.email
    )
    if (dup) {
      return { ok: true, skipped: true, reason: "duplicate" }
    }

    const { html, text } = bodyForEvent(
      input.eventType,
      recipient.businessName,
      recipient.signupGoal
    )
    const sendResult = await sendTransactionalEmail({
      to: recipient.email,
      subject: subjectForEvent(input.eventType),
      html,
      text,
      finza: { businessId: input.businessId, documentType: "trial", workspace: "service" },
    })

    const sentOk = sendResult.success === true
    await insertTenantNotificationLog(admin, {
      business_id: input.businessId,
      event_type: input.eventType,
      lifecycle_key: input.lifecycleKey,
      recipient_email: recipient.email,
      provider_message_id: sentOk ? sendResult.id : null,
      status: sentOk ? "sent" : "failed",
      error_message: sentOk ? null : "reason" in sendResult ? sendResult.reason : "send_failed",
    })

    if (!sentOk) {
      return { ok: false, reason: "send_failed" }
    }
    return { ok: true, sent: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: msg }
  }
}

/** Auth-only users who never created a business (transactional setup reminder). */
export type SendSetupIncompleteEmailInput = {
  userId: string
  userEmail: string
  lifecycleKey: string
}

export async function sendSetupIncompleteEmail(
  input: SendSetupIncompleteEmailInput
): Promise<SendTrialGrowthEmailResult> {
  try {
    const admin = createSupabaseAdminClient()
    const lifecycleKey = input.lifecycleKey
    const eventType = "setup_incomplete_24h"

    // Use a synthetic business_id placeholder — tenant_notification_events requires business_id FK.
    // Skip DB log for auth-only users; dedupe via subscription table pattern isn't available.
    // Store dedupe in user metadata instead.
    const { data: userData } = await admin.auth.admin.getUserById(input.userId)
    const meta = (userData.user?.user_metadata ?? {}) as Record<string, unknown>
    if (meta.setup_incomplete_email_sent === lifecycleKey) {
      return { ok: true, skipped: true, reason: "duplicate" }
    }

    const origin = serviceAppOrigin()
    const setup = `${origin}/business-setup`
    const text = `You started creating a Finza Service account but haven't finished business setup yet.\n\nComplete setup here:\n${setup}`
    const html = `<p style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55">${text.replace(/\n/g, "<br/>")}</p>`

    const sendResult = await sendTransactionalEmail({
      to: input.userEmail,
      subject: subjectForEvent(eventType),
      html,
      text,
      finza: { businessId: input.userId, documentType: "trial", workspace: "service" },
    })

    if (!sendResult.success) {
      return { ok: false, reason: "send_failed" }
    }

    await admin.auth.admin.updateUserById(input.userId, {
      user_metadata: { ...meta, setup_incomplete_email_sent: lifecycleKey },
    })

    return { ok: true, sent: true }
  } catch (e: unknown) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
