import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
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

const QUEUE_COLUMNS =
  "id, name, phone, whatsapp_phone, email, signup_goal, signup_source, signup_utm_source, signup_utm_medium, signup_utm_campaign, trial_contact_consent, service_subscription_tier, service_subscription_status, trial_ends_at, subscription_grace_until, subscription_started_at, onboarding_step, created_at"

const EVENT_FILTERS = new Set(["no_activation", "invoice_no_payment", "pricing_viewed"])

export type TrialConversionQueueMeta = {
  auth_admin_calls: 0
  business_query_count: 1
  activation_event_query_count: number
  duration_ms: number
  page: number
  page_size: number
  scanned: number
  scan_truncated: boolean
}

export type TrialConversionQueuePage = {
  rows: TrialConversionQueueRow[]
  total: number
  meta: TrialConversionQueueMeta
}

type BusinessQueueSource = {
  id: string
  name?: string | null
  phone?: string | null
  whatsapp_phone?: string | null
  email?: string | null
  signup_goal?: string | null
  signup_source?: string | null
  signup_utm_source?: string | null
  signup_utm_medium?: string | null
  signup_utm_campaign?: string | null
  trial_contact_consent?: boolean | null
  service_subscription_tier?: string | null
  service_subscription_status?: string | null
  trial_ends_at?: string | null
  subscription_grace_until?: string | null
  subscription_started_at?: string | null
  onboarding_step?: string | null
}

function rowFromBusiness(
  biz: BusinessQueueSource,
  eventNames: string[],
  now: Date
): TrialConversionQueueRow {
  const eventSet = new Set(eventNames)
  const activation_state = activationStateFromEventNames(eventNames)
  const ownerEmail = looksLikeEmail(biz.email) ? String(biz.email).trim() : null
  const trialStatus = typeof biz.service_subscription_status === "string" ? biz.service_subscription_status : null
  const trialEndsAt = biz.trial_ends_at ? new Date(String(biz.trial_ends_at)) : null
  const trialExpired = trialEndsAt !== null && now >= trialEndsAt
  const graceUntil = biz.subscription_grace_until ? new Date(String(biz.subscription_grace_until)) : null
  const trialGraceActive = trialStatus === "past_due" && graceUntil !== null && now < graceUntil
  const isLocked = trialStatus === "locked"
  const phone = typeof biz.phone === "string" && biz.phone.trim() ? biz.phone.trim() : null
  const whatsapp =
    typeof biz.whatsapp_phone === "string" && biz.whatsapp_phone.trim() ? biz.whatsapp_phone.trim() : phone
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

  return {
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
    is_paid: Boolean(biz.subscription_started_at),
  }
}

function matchesEventFilter(filter: string, eventNames: string[]): boolean {
  const has = (name: string) => eventNames.includes(name)
  if (filter === "no_activation") return !has("customer_created") && !has("invoice_created")
  if (filter === "invoice_no_payment") return has("invoice_created") && !has("payment_recorded")
  if (filter === "pricing_viewed") return has("pricing_viewed")
  return true
}

export async function buildTrialConversionQueue(
  supabase: SupabaseClient,
  options?: { limit?: number; offset?: number; page?: number; filter?: string; trialingOnly?: boolean }
): Promise<TrialConversionQueuePage> {
  const started = Date.now()
  const pageSize = Math.min(Math.max(options?.limit ?? 25, 1), 50)
  const page = Math.max(options?.page ?? (options?.offset ? Math.floor(options.offset / pageSize) + 1 : 1), 1)
  const filter = options?.filter ?? (options?.trialingOnly ? "trialing_only" : "all_unpaid")
  const now = new Date()
  const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString()
  const nowIso = now.toISOString()

  let q = supabase
    .from("businesses")
    .select(QUEUE_COLUMNS)
    .eq("industry", "service")
    .is("archived_at", null)
    .is("subscription_started_at", null)
    .order("created_at", { ascending: false })
    .limit(500)

  if (filter === "trialing_only" || options?.trialingOnly) {
    q = q.eq("service_subscription_status", "trialing")
  } else if (filter === "ending_soon") {
    q = q.eq("service_subscription_status", "trialing").gte("trial_ends_at", nowIso).lte("trial_ends_at", soon)
  } else if (filter === "expired_unpaid") {
    q = q.or(`trial_ends_at.lte.${nowIso},service_subscription_status.in.(past_due,locked)`)
  } else if (filter === "consent_yes") {
    q = q.eq("trial_contact_consent", true)
  } else if (filter === "consent_missing") {
    q = q.or("trial_contact_consent.is.null,trial_contact_consent.eq.false")
  }

  const { data: businesses, error } = await q
  if (error) throw new Error(error.message)

  const scanned = businesses ?? []
  const ids = scanned.map((biz) => String(biz.id))
  const eventsByBusiness = new Map<string, string[]>()
  let activationEventQueryCount = 0
  if (ids.length > 0) {
    activationEventQueryCount = 1
    const { data: events, error: eventsError } = await supabase
      .from("business_activation_events")
      .select("business_id, event_name")
      .in("business_id", ids)
    if (eventsError) throw new Error(eventsError.message)
    for (const event of events ?? []) {
      const businessId = String(event.business_id)
      const list = eventsByBusiness.get(businessId) ?? []
      list.push(String(event.event_name))
      eventsByBusiness.set(businessId, list)
    }
  }

  const filtered = scanned.filter((biz) => {
    if (!EVENT_FILTERS.has(filter)) return true
    return matchesEventFilter(filter, eventsByBusiness.get(String(biz.id)) ?? [])
  })

  const start = (page - 1) * pageSize
  const pageRows = filtered.slice(start, start + pageSize).map((biz) =>
    rowFromBusiness(biz, eventsByBusiness.get(String(biz.id)) ?? [], now)
  )

  return {
    rows: pageRows,
    total: filtered.length,
    meta: {
      auth_admin_calls: 0,
      business_query_count: 1,
      activation_event_query_count: activationEventQueryCount,
      duration_ms: Date.now() - started,
      page,
      page_size: pageSize,
      scanned: scanned.length,
      scan_truncated: scanned.length >= 500,
    },
  }
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
