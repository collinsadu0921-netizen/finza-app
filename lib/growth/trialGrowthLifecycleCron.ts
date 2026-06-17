/**
 * Trial growth lifecycle cron — activation-based follow-ups.
 *
 * Subscription trial ending / grace / lock emails are handled by
 * serviceSubscriptionLifecycleCron + subscription_notification_events.
 * This job adds activation nudges only and avoids duplicating those messages.
 */
import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { recordBusinessActivationEvent } from "@/lib/growth/recordBusinessActivationEvent"
import {
  sendSetupIncompleteEmail,
  sendTrialGrowthEmail,
} from "@/lib/growth/sendTrialGrowthNotification"

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export type TrialGrowthLifecycleCronSummary = {
  setupIncompleteChecked: number
  setupIncompleteSent: number
  noActivationChecked: number
  noActivationSent: number
  invoiceNoPaymentChecked: number
  invoiceNoPaymentSent: number
  trialExpiredEventsRecorded: number
  errors: string[]
}

type BusinessRow = {
  id: string
  created_at: string
  industry: string | null
  subscription_started_at: string | null
  trial_contact_consent: boolean | null
  service_subscription_status: string | null
  trial_ends_at: string | null
  subscription_grace_until: string | null
}

async function listActivationEventNames(
  supabase: SupabaseClient,
  businessId: string
): Promise<Set<string>> {
  const { data } = await supabase
    .from("business_activation_events")
    .select("event_name")
    .eq("business_id", businessId)
  return new Set((data ?? []).map((r) => String(r.event_name)))
}

export async function runTrialGrowthLifecycleCron(
  supabase: SupabaseClient,
  now: Date = new Date()
): Promise<TrialGrowthLifecycleCronSummary> {
  const summary: TrialGrowthLifecycleCronSummary = {
    setupIncompleteChecked: 0,
    setupIncompleteSent: 0,
    noActivationChecked: 0,
    noActivationSent: 0,
    invoiceNoPaymentChecked: 0,
    invoiceNoPaymentSent: 0,
    trialExpiredEventsRecorded: 0,
    errors: [],
  }

  const admin = createSupabaseAdminClient()
  const nowMs = now.getTime()
  const cutoff24h = new Date(nowMs - DAY_MS).toISOString()

  // --- Auth users without businesses (>24h, service trial intent) ---
  try {
    const { data: userList, error: listErr } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    })
    if (listErr) {
      summary.errors.push(`listUsers: ${listErr.message}`)
    } else {
      const users = userList.users ?? []
      const candidateUsers = users.filter((u) => {
        const created = u.created_at ? new Date(u.created_at).getTime() : 0
        if (created > nowMs - DAY_MS) return false
        const meta = (u.user_metadata ?? {}) as Record<string, unknown>
        if (meta.signup_intent === "accounting_firm") return false
        return meta.trial_intent === true || meta.signup_intent === "business_owner"
      })

      for (const u of candidateUsers) {
        const { data: owned } = await supabase
          .from("businesses")
          .select("id")
          .eq("owner_id", u.id)
          .is("archived_at", null)
          .limit(1)
          .maybeSingle()

        if (owned?.id) continue
        if (!u.email) continue

        summary.setupIncompleteChecked++
        const lifecycleKey = `setup_incomplete:${u.id}:${u.created_at?.slice(0, 10) ?? "unknown"}`
        const r = await sendSetupIncompleteEmail({
          userId: u.id,
          userEmail: u.email,
          lifecycleKey,
        })
        if ("sent" in r && r.sent) summary.setupIncompleteSent++
      }
    }
  } catch (e: unknown) {
    summary.errors.push(`setup_incomplete: ${e instanceof Error ? e.message : String(e)}`)
  }

  // --- Service businesses in trial funnel (never paid) ---
  const { data: businesses, error: bizErr } = await supabase
    .from("businesses")
    .select(
      "id, created_at, industry, subscription_started_at, trial_contact_consent, service_subscription_status, trial_ends_at, subscription_grace_until"
    )
    .eq("industry", "service")
    .is("archived_at", null)
    .is("subscription_started_at", null)
    .lte("created_at", cutoff24h)

  if (bizErr) {
    summary.errors.push(`list businesses: ${bizErr.message}`)
    return summary
  }

  for (const raw of businesses ?? []) {
    const biz = raw as BusinessRow
    if (biz.trial_contact_consent !== true) continue

    const events = await listActivationEventNames(supabase, biz.id)

    // no_activation_24h
    if (
      !events.has("customer_created") &&
      !events.has("invoice_created") &&
      new Date(biz.created_at).getTime() <= nowMs - DAY_MS
    ) {
      summary.noActivationChecked++
      const lifecycleKey = `${biz.id}|no_activation_24h`
      const r = await sendTrialGrowthEmail({
        businessId: biz.id,
        eventType: "no_activation_24h",
        lifecycleKey,
      })
      if ("sent" in r && r.sent) summary.noActivationSent++
      else if (!r.ok && !("skipped" in r)) summary.errors.push(`no_activation ${biz.id}: ${r.reason}`)
    }

    // invoice_no_payment_48h
    if (events.has("invoice_created") && !events.has("payment_recorded")) {
      const { data: invEvent } = await supabase
        .from("business_activation_events")
        .select("event_at")
        .eq("business_id", biz.id)
        .eq("event_name", "invoice_created")
        .maybeSingle()

      const invAt = invEvent?.event_at ? new Date(String(invEvent.event_at)).getTime() : null
      if (invAt !== null && invAt <= nowMs - 2 * DAY_MS) {
        summary.invoiceNoPaymentChecked++
        const lifecycleKey = `${biz.id}|invoice_no_payment_48h`
        const r = await sendTrialGrowthEmail({
          businessId: biz.id,
          eventType: "invoice_no_payment_48h",
          lifecycleKey,
        })
        if ("sent" in r && r.sent) summary.invoiceNoPaymentSent++
      }
    }

    // Record trial_expired activation event once (cron may run before subscription cron)
    const trialEnds = biz.trial_ends_at ? new Date(biz.trial_ends_at).getTime() : null
    if (
      trialEnds !== null &&
      trialEnds <= nowMs &&
      !events.has("trial_expired") &&
      !events.has("subscription_started")
    ) {
      const rec = await recordBusinessActivationEvent(supabase, {
        businessId: biz.id,
        eventName: "trial_expired",
      })
      if (rec.ok && rec.recorded) summary.trialExpiredEventsRecorded++
    }
  }


  return summary
}
