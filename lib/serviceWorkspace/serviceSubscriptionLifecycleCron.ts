/**
 * Service subscription lifecycle batch job.
 * Used by POST/GET /api/cron/service-subscription-lifecycle.
 *
 * - trial_ending_3d / trial_ending_1d: reminders before trial ends
 * - trial_grace_started: expired unpaid trial → past_due + 3-day grace (only if grace_until is null)
 * - grace_ending_24h: grace expires within 24h (paid renewal or unpaid trial)
 * - subscription_locked: past_due + grace_until <= now → locked (paid and unpaid)
 */
import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  sendSubscriptionLifecycleNotification,
  type SendSubscriptionLifecycleNotificationResult,
} from "@/lib/serviceWorkspace/sendSubscriptionLifecycleNotification"
import { voidRecordBusinessActivationEvent } from "@/lib/growth/recordBusinessActivationEvent"

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
export const TRIAL_POST_EXPIRY_GRACE_DAYS = 3

export type ServiceSubscriptionLifecycleCronSummary = {
  trialEnding3dChecked: number
  trialEnding3dSent: number
  trialEnding1dChecked: number
  trialEnding1dSent: number
  trialGraceStartedChecked: number
  trialGraceStartedUpdated: number
  trialGraceStartedNotified: number
  graceEndingChecked: number
  graceEndingSent: number
  lockedChecked: number
  lockedUpdated: number
  lockedNotified: number
  errors: string[]
}

export type TrialCandidateRow = { id: string; trial_ends_at: string }
export type GraceCandidateRow = { id: string; subscription_grace_until: string }
export type ExpiredUnpaidTrialRow = { id: string; trial_ends_at: string }

export type SubscriptionLifecycleCronQueries = {
  listTrialEnding3d: (now: Date) => Promise<TrialCandidateRow[]>
  listTrialEnding1d: (now: Date) => Promise<TrialCandidateRow[]>
  listExpiredUnpaidTrialsNeedingGrace: (now: Date) => Promise<ExpiredUnpaidTrialRow[]>
  startTrialPostExpiryGrace: (
    businessId: string,
    graceUntilIso: string,
    now: Date
  ) => Promise<{ error: { message: string } | null }>
  listGraceEnding24h: (now: Date) => Promise<GraceCandidateRow[]>
  listLockExpiredGrace: (now: Date) => Promise<GraceCandidateRow[]>
  lockPastDueGraceExpired: (
    businessId: string,
    now: Date
  ) => Promise<{ error: { message: string } | null }>
}

function utcDateKeyFromIso(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso.slice(0, 10)
  return new Date(iso).toISOString().slice(0, 10)
}

function lifecycleKeyTrial(trialEndsAtIso: string, businessId: string): string {
  return `${utcDateKeyFromIso(trialEndsAtIso)}|${businessId}`
}

function lifecycleKeyGrace(graceUntilIso: string, businessId: string): string {
  return `${graceUntilIso}|${businessId}`
}

function countsAsEmailSent(r: SendSubscriptionLifecycleNotificationResult): boolean {
  if (!r.ok) return false
  if ("skipped" in r && r.skipped) return false
  return true
}

export function trialPostExpiryGraceUntilIso(now: Date): string {
  return new Date(now.getTime() + TRIAL_POST_EXPIRY_GRACE_DAYS * DAY_MS).toISOString()
}

export function createSubscriptionLifecycleCronQueries(
  supabase: SupabaseClient
): SubscriptionLifecycleCronQueries {
  return {
    async listTrialEnding3d(now: Date): Promise<TrialCandidateRow[]> {
      const ms = now.getTime()
      const gte = new Date(ms + 2 * DAY_MS).toISOString()
      const lt = new Date(ms + 4 * DAY_MS).toISOString()
      const { data, error } = await supabase
        .from("businesses")
        .select("id, trial_ends_at")
        .eq("service_subscription_status", "trialing")
        .not("trial_ends_at", "is", null)
        .gte("trial_ends_at", gte)
        .lt("trial_ends_at", lt)
        .eq("billing_exempt", false)
        .is("archived_at", null)

      if (error) throw new Error(`listTrialEnding3d: ${error.message}`)
      return (data ?? []) as TrialCandidateRow[]
    },

    async listTrialEnding1d(now: Date): Promise<TrialCandidateRow[]> {
      const ms = now.getTime()
      const gte = new Date(ms + 12 * HOUR_MS).toISOString()
      const lt = new Date(ms + 36 * HOUR_MS).toISOString()
      const { data, error } = await supabase
        .from("businesses")
        .select("id, trial_ends_at")
        .eq("service_subscription_status", "trialing")
        .not("trial_ends_at", "is", null)
        .gte("trial_ends_at", gte)
        .lt("trial_ends_at", lt)
        .eq("billing_exempt", false)
        .is("archived_at", null)

      if (error) throw new Error(`listTrialEnding1d: ${error.message}`)
      return (data ?? []) as TrialCandidateRow[]
    },

    async listExpiredUnpaidTrialsNeedingGrace(
      now: Date
    ): Promise<ExpiredUnpaidTrialRow[]> {
      const nowIso = now.toISOString()
      const { data, error } = await supabase
        .from("businesses")
        .select("id, trial_ends_at")
        .eq("service_subscription_status", "trialing")
        .not("trial_ends_at", "is", null)
        .lte("trial_ends_at", nowIso)
        .is("subscription_started_at", null)
        .is("subscription_grace_until", null)
        .eq("billing_exempt", false)
        .is("archived_at", null)

      if (error) {
        throw new Error(`listExpiredUnpaidTrialsNeedingGrace: ${error.message}`)
      }
      return (data ?? []) as ExpiredUnpaidTrialRow[]
    },

    async startTrialPostExpiryGrace(
      businessId: string,
      graceUntilIso: string,
      now: Date
    ): Promise<{ error: { message: string } | null }> {
      const { error } = await supabase
        .from("businesses")
        .update({
          service_subscription_status: "past_due",
          subscription_grace_until: graceUntilIso,
          updated_at: now.toISOString(),
        })
        .eq("id", businessId)
        .eq("service_subscription_status", "trialing")
        .is("subscription_started_at", null)
        .is("subscription_grace_until", null)
        .eq("billing_exempt", false)
        .is("archived_at", null)

      return { error: error ? { message: error.message } : null }
    },

    async listGraceEnding24h(now: Date): Promise<GraceCandidateRow[]> {
      const ms = now.getTime()
      const nowIso = new Date(ms).toISOString()
      const beforeIso = new Date(ms + 24 * HOUR_MS).toISOString()
      const { data, error } = await supabase
        .from("businesses")
        .select("id, subscription_grace_until")
        .eq("service_subscription_status", "past_due")
        .not("subscription_grace_until", "is", null)
        .gt("subscription_grace_until", nowIso)
        .lte("subscription_grace_until", beforeIso)
        .eq("billing_exempt", false)
        .is("archived_at", null)

      if (error) throw new Error(`listGraceEnding24h: ${error.message}`)
      return (data ?? []) as GraceCandidateRow[]
    },

    async listLockExpiredGrace(now: Date): Promise<GraceCandidateRow[]> {
      const nowIso = now.toISOString()
      const { data, error } = await supabase
        .from("businesses")
        .select("id, subscription_grace_until")
        .eq("service_subscription_status", "past_due")
        .not("subscription_grace_until", "is", null)
        .lte("subscription_grace_until", nowIso)
        .eq("billing_exempt", false)
        .is("archived_at", null)

      if (error) throw new Error(`listLockExpiredGrace: ${error.message}`)
      return (data ?? []) as GraceCandidateRow[]
    },

    async lockPastDueGraceExpired(
      businessId: string,
      now: Date
    ): Promise<{ error: { message: string } | null }> {
      const { error } = await supabase
        .from("businesses")
        .update({
          service_subscription_status: "locked",
          updated_at: now.toISOString(),
        })
        .eq("id", businessId)
        .eq("service_subscription_status", "past_due")
        .eq("billing_exempt", false)
        .is("archived_at", null)

      return { error: error ? { message: error.message } : null }
    },
  }
}

type SendFn = typeof sendSubscriptionLifecycleNotification

export async function executeServiceSubscriptionLifecycleCron(
  queries: SubscriptionLifecycleCronQueries,
  send: SendFn,
  now: Date = new Date(),
  supabase?: SupabaseClient
): Promise<ServiceSubscriptionLifecycleCronSummary> {
  const summary: ServiceSubscriptionLifecycleCronSummary = {
    trialEnding3dChecked: 0,
    trialEnding3dSent: 0,
    trialEnding1dChecked: 0,
    trialEnding1dSent: 0,
    trialGraceStartedChecked: 0,
    trialGraceStartedUpdated: 0,
    trialGraceStartedNotified: 0,
    graceEndingChecked: 0,
    graceEndingSent: 0,
    lockedChecked: 0,
    lockedUpdated: 0,
    lockedNotified: 0,
    errors: [],
  }

  const safeSend = async (
    input: Parameters<SendFn>[0],
    phase: string
  ): Promise<SendSubscriptionLifecycleNotificationResult> => {
    try {
      return await send(input)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      summary.errors.push(`${phase}: send threw ${msg}`)
      return { ok: false, reason: msg }
    }
  }

  const graceUntilIso = trialPostExpiryGraceUntilIso(now)

  try {
    const trial3d = await queries.listTrialEnding3d(now)
    summary.trialEnding3dChecked = trial3d.length
    for (const row of trial3d) {
      const r = await safeSend(
        {
          businessId: row.id,
          eventType: "trial_ending_3d",
          lifecycleKey: lifecycleKeyTrial(row.trial_ends_at, row.id),
        },
        "trial_ending_3d"
      )
      if (countsAsEmailSent(r)) summary.trialEnding3dSent++
      else if (!r.ok) summary.errors.push(`trial_ending_3d ${row.id}: ${r.reason}`)
    }

    const trial1d = await queries.listTrialEnding1d(now)
    summary.trialEnding1dChecked = trial1d.length
    for (const row of trial1d) {
      const r = await safeSend(
        {
          businessId: row.id,
          eventType: "trial_ending_1d",
          lifecycleKey: lifecycleKeyTrial(row.trial_ends_at, row.id),
        },
        "trial_ending_1d"
      )
      if (countsAsEmailSent(r)) summary.trialEnding1dSent++
      else if (!r.ok) summary.errors.push(`trial_ending_1d ${row.id}: ${r.reason}`)
    }

    const expiredTrials = await queries.listExpiredUnpaidTrialsNeedingGrace(now)
    summary.trialGraceStartedChecked = expiredTrials.length
    for (const row of expiredTrials) {
      try {
        const { error } = await queries.startTrialPostExpiryGrace(
          row.id,
          graceUntilIso,
          now
        )
        if (error) {
          summary.errors.push(`trial_grace_start ${row.id}: ${error.message}`)
          continue
        }
        summary.trialGraceStartedUpdated++
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        summary.errors.push(`trial_grace_start ${row.id}: threw ${msg}`)
        continue
      }

      if (supabase) {
        voidRecordBusinessActivationEvent(supabase, {
          businessId: row.id,
          eventName: "trial_expired",
          metadata: { trial_ends_at: row.trial_ends_at },
        })
      }

      const r = await safeSend(
        {
          businessId: row.id,
          eventType: "trial_grace_started",
          lifecycleKey: `${graceUntilIso}|${row.id}`,
        },
        "trial_grace_started"
      )
      if (countsAsEmailSent(r)) summary.trialGraceStartedNotified++
      else if (!r.ok) summary.errors.push(`trial_grace_started ${row.id}: ${r.reason}`)
    }

    const graceRows = await queries.listGraceEnding24h(now)
    summary.graceEndingChecked = graceRows.length
    for (const row of graceRows) {
      const graceIso = String(row.subscription_grace_until)
      const r = await safeSend(
        {
          businessId: row.id,
          eventType: "grace_ending_24h",
          lifecycleKey: lifecycleKeyGrace(graceIso, row.id),
        },
        "grace_ending_24h"
      )
      if (countsAsEmailSent(r)) summary.graceEndingSent++
      else if (!r.ok) summary.errors.push(`grace_ending_24h ${row.id}: ${r.reason}`)
    }

    const lockRows = await queries.listLockExpiredGrace(now)
    summary.lockedChecked = lockRows.length
    for (const row of lockRows) {
      const graceIso = String(row.subscription_grace_until)
      try {
        const { error } = await queries.lockPastDueGraceExpired(row.id, now)
        if (error) {
          summary.errors.push(`lock update ${row.id}: ${error.message}`)
          continue
        }
        summary.lockedUpdated++
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        summary.errors.push(`lock update ${row.id}: threw ${msg}`)
        continue
      }

      const r = await safeSend(
        {
          businessId: row.id,
          eventType: "subscription_locked",
          lifecycleKey: lifecycleKeyGrace(graceIso, row.id),
        },
        "subscription_locked"
      )
      if (countsAsEmailSent(r)) summary.lockedNotified++
      else if (!r.ok) summary.errors.push(`subscription_locked ${row.id}: ${r.reason}`)
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    summary.errors.push(`fatal: ${msg}`)
  }

  return summary
}

export async function runServiceSubscriptionLifecycleCron(
  supabase: SupabaseClient,
  options?: { now?: Date; send?: SendFn }
): Promise<ServiceSubscriptionLifecycleCronSummary> {
  const queries = createSubscriptionLifecycleCronQueries(supabase)
  return executeServiceSubscriptionLifecycleCron(
    queries,
    options?.send ?? sendSubscriptionLifecycleNotification,
    options?.now ?? new Date(),
    supabase
  )
}
