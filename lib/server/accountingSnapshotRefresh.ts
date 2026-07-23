/**
 * Accounting snapshot refresh queue helpers (522/544).
 * Durable enqueue remains authoritative; immediate targeted drain is best-effort.
 *
 * Background ownership: callers (routes) own waitUntil via scheduleBackground, or
 * await the returned promise inside a request-owned async chain (afterAccountingPost).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import { toAccountingDateOnly } from "@/lib/server/accountingPeriodDate"
import { PNL_SNAPSHOT_FRESH_SECONDS } from "@/lib/server/dashboardPeriodSummaryRead"
import {
  processAccountingSnapshotsForPeriod,
  type SnapshotRefreshTriggerSource,
} from "@/lib/server/accountingSnapshotWorker"

export { toAccountingDateOnly } from "@/lib/server/accountingPeriodDate"

/**
 * Default OFF — durable queue + recovery remain the only drain path.
 * Uses dynamic env key access so Vercel/Next does not bake an empty build-time value.
 */
export function isAccountingImmediateRefreshEnabled(): boolean {
  const env = process.env as Record<string, string | undefined>
  const raw = String(env["ACCOUNTING_IMMEDIATE_REFRESH_ENABLED"] ?? "")
    .trim()
    .toLowerCase()
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
}

const TARGETED_REFRESH_COOLDOWN_MS = 2_000
const EMPTY_CLAIM_RETRY_DELAY_MS = 150
const targetedRefreshInFlight = new Map<string, Promise<void>>()
const targetedRefreshCooldownUntil = new Map<string, number>()

function targetedRefreshKey(
  businessId: string,
  periodStart: string,
  periodEnd: string
): string {
  return `${businessId}|${periodStart}|${periodEnd}`
}

export type ScheduleTargetedSnapshotRefreshInput = {
  businessId: string
  periodStart: string
  periodEnd: string
  triggerSource?: SnapshotRefreshTriggerSource
  /**
   * Request-owned background attachment (Vercel waitUntil).
   * Prefer this at route boundaries. When omitted, callers must await `promise`
   * inside a waitUntil-owned async function (e.g. afterAccountingPost).
   */
  scheduleBackground?: (promise: Promise<unknown>) => void
  /** Test injection — production uses service-role admin client. */
  run?: () => Promise<unknown>
}

export type ScheduleTargetedSnapshotRefreshResult = {
  scheduled: boolean
  reason: string
  /** Present when work was started; attach via waitUntil or await in request-owned chain. */
  promise: Promise<void> | null
  immediate_refresh_enabled: boolean
  period_start?: string
  period_end?: string
}

/**
 * Best-effort immediate targeted refresh after a journal/durable enqueue.
 * Never throws to callers. Never owns durability.
 */
export function scheduleTargetedSnapshotRefresh(
  input: ScheduleTargetedSnapshotRefreshInput
): ScheduleTargetedSnapshotRefreshResult {
  const immediateEnabled = isAccountingImmediateRefreshEnabled()
  if (!immediateEnabled) {
    return {
      scheduled: false,
      reason: "immediate_refresh_disabled",
      promise: null,
      immediate_refresh_enabled: false,
    }
  }

  const periodStart = toAccountingDateOnly(input.periodStart)
  const periodEnd = toAccountingDateOnly(input.periodEnd)
  const businessId = input.businessId?.trim() || ""
  if (!businessId || !periodStart || !periodEnd) {
    return {
      scheduled: false,
      reason: "invalid_period_scope",
      promise: null,
      immediate_refresh_enabled: true,
    }
  }

  const key = targetedRefreshKey(businessId, periodStart, periodEnd)
  const now = Date.now()
  const coolUntil = targetedRefreshCooldownUntil.get(key) ?? 0
  if (coolUntil > now) {
    return {
      scheduled: false,
      reason: "cooldown",
      promise: null,
      immediate_refresh_enabled: true,
      period_start: periodStart,
      period_end: periodEnd,
    }
  }
  if (targetedRefreshInFlight.has(key)) {
    return {
      scheduled: false,
      reason: "in_flight",
      promise: null,
      immediate_refresh_enabled: true,
      period_start: periodStart,
      period_end: periodEnd,
    }
  }

  const triggerSource = input.triggerSource ?? "post_transaction"
  const work = (async () => {
    try {
      console.info("[accounting-snapshot] targeted refresh start", {
        business_id: businessId,
        period_start: periodStart,
        period_end: periodEnd,
        trigger_source: triggerSource,
        immediate_refresh_enabled: true,
      })
      if (input.run) {
        await input.run()
        return
      }
      const { createSupabaseAdminClient } = await import("@/lib/supabaseAdmin")
      const supabase = createSupabaseAdminClient()
      await processAccountingSnapshotsForPeriod(supabase, {
        businessId,
        periodStart,
        periodEnd,
        maxJobs: 5,
        triggerSource,
        emptyClaimRetry: true,
        emptyClaimRetryDelayMs: EMPTY_CLAIM_RETRY_DELAY_MS,
      })
    } catch (err) {
      console.warn("[accounting-snapshot] targeted refresh failed:", {
        business_id: businessId,
        period_start: periodStart,
        period_end: periodEnd,
        trigger_source: triggerSource,
        immediate_refresh_enabled: true,
        error: err instanceof Error ? err.message.slice(0, 300) : "unknown_error",
      })
    } finally {
      targetedRefreshInFlight.delete(key)
      // Arm cooldown after work finishes so empty-claim retry inside the same run is not blocked.
      targetedRefreshCooldownUntil.set(key, Date.now() + TARGETED_REFRESH_COOLDOWN_MS)
    }
  })()

  targetedRefreshInFlight.set(key, work)

  if (input.scheduleBackground) {
    try {
      input.scheduleBackground(work)
    } catch (err) {
      console.warn(
        "[accounting-snapshot] scheduleBackground failed:",
        err instanceof Error ? err.message : String(err)
      )
      void work
    }
  }

  return {
    scheduled: true,
    reason: "scheduled",
    promise: work,
    immediate_refresh_enabled: true,
    period_start: periodStart,
    period_end: periodEnd,
  }
}

/** Test-only: clear in-process coalescing state. */
export function resetTargetedSnapshotRefreshCoalescingForTests(): void {
  targetedRefreshInFlight.clear()
  targetedRefreshCooldownUntil.clear()
}

export type PnlSnapshotMetadata = {
  line_count: number
  revenue: number | string
  expenses: number | string
  net_profit: number | string
  refreshed_at: string
  source_version: number
  snapshotStale: boolean
}

export type SnapshotRefreshJobType = "dashboard" | "pnl" | "both"

export async function readPnlSnapshotMetadata(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string,
  maxStaleSeconds: number = PNL_SNAPSHOT_FRESH_SECONDS
): Promise<PnlSnapshotMetadata | null> {
  const { data, error } = await supabase.rpc("get_service_pnl_movement_snapshot_metadata", {
    p_business_id: businessId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_max_stale_seconds: maxStaleSeconds,
  })
  if (error) {
    console.warn("[accounting-snapshot] metadata read failed:", error.message)
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== "object") return null
  return { ...(row as Omit<PnlSnapshotMetadata, "snapshotStale">), snapshotStale: false }
}

export async function readStalePnlSnapshotMetadata(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string
): Promise<PnlSnapshotMetadata | null> {
  const { data, error } = await supabase.rpc("get_stale_service_pnl_movement_snapshot_metadata", {
    p_business_id: businessId,
    p_start_date: startDate,
    p_end_date: endDate,
  })
  if (error) {
    console.warn("[accounting-snapshot] stale metadata read failed:", error.message)
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== "object") return null
  return { ...(row as Omit<PnlSnapshotMetadata, "snapshotStale">), snapshotStale: true }
}

export async function periodHasLivePnlMovement(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc("period_has_live_pnl_movement", {
    p_business_id: businessId,
    p_start_date: startDate,
    p_end_date: endDate,
  })
  if (error) {
    console.warn("[accounting-snapshot] live movement probe failed:", error.message)
    return false
  }
  return Boolean(data)
}

export async function enqueueSnapshotRefreshJob(
  supabase: SupabaseClient,
  input: {
    businessId: string
    periodStart: string
    periodEnd: string
    jobType?: SnapshotRefreshJobType
    reason?: string
    sourceType?: string | null
    sourceId?: string | null
  }
): Promise<string | null> {
  const periodStart = toAccountingDateOnly(input.periodStart)
  const periodEnd = toAccountingDateOnly(input.periodEnd)
  if (!periodStart || !periodEnd) {
    console.warn("[accounting-snapshot] enqueue skipped: invalid period bounds")
    return null
  }
  const { data, error } = await supabase.rpc("enqueue_accounting_snapshot_refresh_job", {
    p_business_id: input.businessId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_job_type: input.jobType ?? "both",
    p_reason: input.reason ?? "read_path_missing_snapshot",
    p_source_type: input.sourceType ?? null,
    p_source_id: input.sourceId ?? null,
  })
  if (error) {
    console.warn("[accounting-snapshot] enqueue failed:", error.message)
    return null
  }
  return typeof data === "string" ? data : null
}

/**
 * Durable enqueue first, then request-owned immediate schedule.
 * Awaits enqueue so the scoped claim can see the row.
 */
export async function enqueueAndScheduleTargetedSnapshotRefresh(
  supabase: SupabaseClient,
  input: {
    businessId: string
    periodStart: string
    periodEnd: string
    jobType?: SnapshotRefreshJobType
    reason?: string
    sourceType?: string | null
    sourceId?: string | null
    triggerSource?: SnapshotRefreshTriggerSource
  }
): Promise<{
  jobId: string | null
  scheduled: boolean
  reason: string
  immediate_refresh_enabled: boolean
}> {
  const jobId = await enqueueSnapshotRefreshJob(supabase, {
    businessId: input.businessId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    jobType: input.jobType,
    reason: input.reason,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
  })
  // Do not nest scheduleBackground here — callers waitUntil() this whole async function
  // so enqueue + targeted processing stay on one request-owned chain.
  const scheduled = scheduleTargetedSnapshotRefresh({
    businessId: input.businessId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    triggerSource: input.triggerSource,
  })
  if (scheduled.promise) {
    await scheduled.promise
  }
  return {
    jobId,
    scheduled: scheduled.scheduled,
    reason: scheduled.reason,
    immediate_refresh_enabled: scheduled.immediate_refresh_enabled,
  }
}

export async function ensureZeroPnlSnapshotForPeriod(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc("ensure_zero_pnl_snapshot_for_period", {
    p_business_id: businessId,
    p_start_date: startDate,
    p_end_date: endDate,
  })
  if (error) {
    console.warn("[accounting-snapshot] ensure zero snapshot failed:", error.message)
    return false
  }
  return Boolean(data)
}
