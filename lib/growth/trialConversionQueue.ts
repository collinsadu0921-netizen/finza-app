import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { signupGoalLabel } from "@/lib/growth/signupGoals"
import {
  activationStateFromEventNames,
  buildWhatsAppFollowUpAction,
  type TrialConversionActivationState,
} from "@/lib/growth/whatsappFollowUp"

export type TrialConversionQueueRow = {
  business_id: string
  business_name: string
  owner_email: string | null
  phone: string | null
  whatsapp_phone: string | null
  signup_goal: string | null
  signup_goal_label: string
  signup_source: string | null
  signup_utm_source: string | null
  signup_utm_medium: string | null
  signup_utm_campaign: string | null
  trial_contact_consent: boolean
  service_subscription_tier: string | null
  trial_status: string | null
  trial_ends_at: string | null
  subscription_grace_until: string | null
  onboarding_step: string | null
  activation_state: TrialConversionActivationState
  activation_events: string[]
  next_recommended_action: string
  suggested_whatsapp_message: string
  whatsapp_url: string | null
  is_paid: boolean
}

function looksLikeEmail(s: string | null | undefined): boolean {
  if (!s?.trim()) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

export async function buildTrialConversionQueue(
  supabase: SupabaseClient,
  options?: { limit?: number; trialingOnly?: boolean }
): Promise<TrialConversionQueueRow[]> {
  const limit = options?.limit ?? 100
  const admin = createSupabaseAdminClient()

  let q = supabase
    .from("businesses")
    .select(
      "id, name, phone, whatsapp_phone, owner_id, email, signup_goal, signup_source, signup_utm_source, signup_utm_medium, signup_utm_campaign, trial_contact_consent, service_subscription_tier, service_subscription_status, trial_ends_at, subscription_grace_until, subscription_started_at, onboarding_step, created_at"
    )
    .eq("industry", "service")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (options?.trialingOnly) {
    q = q.in("service_subscription_status", ["trialing", "past_due", "locked"])
  }

  const { data: businesses, error } = await q
  if (error) throw new Error(error.message)

  const rows: TrialConversionQueueRow[] = []

  for (const biz of businesses ?? []) {
    const isPaid = Boolean(biz.subscription_started_at)
    if (isPaid && options?.trialingOnly) continue

    const { data: events } = await supabase
      .from("business_activation_events")
      .select("event_name")
      .eq("business_id", biz.id)

    const eventNames = (events ?? []).map((e) => String(e.event_name))
    const eventSet = new Set(eventNames)
    const activation_state = activationStateFromEventNames(eventNames)

    let ownerEmail: string | null = looksLikeEmail(biz.email) ? String(biz.email).trim() : null
    if (!ownerEmail && biz.owner_id) {
      const { data: ownerAuth } = await admin.auth.admin.getUserById(String(biz.owner_id))
      if (looksLikeEmail(ownerAuth.user?.email)) {
        ownerEmail = String(ownerAuth.user!.email).trim()
      }
    }

    const trialStatus = typeof biz.service_subscription_status === "string" ? biz.service_subscription_status : null
    const trialEndsAt = biz.trial_ends_at ? new Date(String(biz.trial_ends_at)) : null
    const now = new Date()
    const trialExpired = trialEndsAt !== null && now >= trialEndsAt
    const graceUntil = biz.subscription_grace_until ? new Date(String(biz.subscription_grace_until)) : null
    const trialGraceActive =
      trialStatus === "past_due" && graceUntil !== null && now < graceUntil
    const isLocked = trialStatus === "locked"

    const phone = typeof biz.phone === "string" && biz.phone.trim() ? biz.phone.trim() : null
    const whatsapp =
      typeof biz.whatsapp_phone === "string" && biz.whatsapp_phone.trim()
        ? biz.whatsapp_phone.trim()
        : phone

    const wa = buildWhatsAppFollowUpAction(
      {
        businessName: String(biz.name ?? "your business"),
        signupGoal: typeof biz.signup_goal === "string" ? biz.signup_goal : null,
        trialStatus,
        trialExpired,
        trialGraceActive,
        isLocked,
        activationState: activation_state,
        events: eventSet,
      },
      whatsapp
    )

    rows.push({
      business_id: String(biz.id),
      business_name: String(biz.name ?? ""),
      owner_email: ownerEmail,
      phone,
      whatsapp_phone: whatsapp,
      signup_goal: typeof biz.signup_goal === "string" ? biz.signup_goal : null,
      signup_goal_label: signupGoalLabel(typeof biz.signup_goal === "string" ? biz.signup_goal : null),
      signup_source: typeof biz.signup_source === "string" ? biz.signup_source : null,
      signup_utm_source: typeof biz.signup_utm_source === "string" ? biz.signup_utm_source : null,
      signup_utm_medium: typeof biz.signup_utm_medium === "string" ? biz.signup_utm_medium : null,
      signup_utm_campaign: typeof biz.signup_utm_campaign === "string" ? biz.signup_utm_campaign : null,
      trial_contact_consent: biz.trial_contact_consent === true,
      service_subscription_tier:
        typeof biz.service_subscription_tier === "string" ? biz.service_subscription_tier : null,
      trial_status: trialStatus,
      trial_ends_at: biz.trial_ends_at ? String(biz.trial_ends_at) : null,
      subscription_grace_until: biz.subscription_grace_until ? String(biz.subscription_grace_until) : null,
      onboarding_step: typeof biz.onboarding_step === "string" ? biz.onboarding_step : null,
      activation_state,
      activation_events: eventNames,
      next_recommended_action: wa.next_recommended_action,
      suggested_whatsapp_message: wa.suggested_message,
      whatsapp_url: wa.whatsapp_url,
      is_paid: isPaid,
    })
  }

  return rows
}

/**
 * SQL reference for founder/admin manual queries:
 *
 * SELECT b.id, b.name, b.phone, b.whatsapp_phone, b.signup_goal, b.signup_source,
 *        b.service_subscription_status, b.trial_ends_at, b.onboarding_step,
 *        array_agg(e.event_name) AS events
 * FROM businesses b
 * LEFT JOIN business_activation_events e ON e.business_id = b.id
 * WHERE b.industry = 'service' AND b.archived_at IS NULL
 *   AND b.subscription_started_at IS NULL
 * GROUP BY b.id
 * ORDER BY b.created_at DESC;
 */
