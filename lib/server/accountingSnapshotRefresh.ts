/**
 * Accounting snapshot refresh queue helpers (522/544).
 * Durable enqueue remains authoritative; immediate targeted drain is best-effort.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import { PNL_SNAPSHOT_FRESH_SECONDS } from "@/lib/server/dashboardPeriodSummaryRead"
import {
  processAccountingSnapshotsForPeriod,
  type SnapshotRefreshTriggerSource,
} from "@/lib/server/accountingSnapshotWorker"

/** Default OFF — durable queue + five-minute recovery remain the only drain path. */
export function isAccountingImmediateRefreshEnabled(): boolean {
  const raw = String(process.env.ACCOUNTING_IMMEDIATE_REFRESH_ENABLED ?? "")
    .trim()
    .toLowerCase()
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
}

const TARGETED_REFRESH_COOLDOWN_MS = 2_000
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
  /** Optional Vercel waitUntil (or test harness). When omitted, fire-and-forget. */
  scheduleBackground?: (promise: Promise<unknown>) => void
  /** Test injection — production uses service-role admin client. */
  run?: () => Promise<unknown>
}

/**
 * Best-effort immediate targeted refresh after a journal/durable enqueue.
 * Never throws to callers. Never owns durability. Empty scoped claim exits immediately.
 */
export function scheduleTargetedSnapshotRefresh(
  input: ScheduleTargetedSnapshotRefreshInput
): { scheduled: boolean; reason: string } {
  if (!isAccountingImmediateRefreshEnabled()) {
    return { scheduled: false, reason: "immediate_refresh_disabled" }
  }

  const { businessId, periodStart, periodEnd } = input
  if (!businessId || !periodStart || !periodEnd) {
    return { scheduled: false, reason: "invalid_period_scope" }
  }

  const key = targetedRefreshKey(businessId, periodStart, periodEnd)
  const now = Date.now()
  const coolUntil = targetedRefreshCooldownUntil.get(key) ?? 0
  if (coolUntil > now) {
    return { scheduled: false, reason: "cooldown" }
  }
  if (targetedRefreshInFlight.has(key)) {
    return { scheduled: false, reason: "in_flight" }
  }

  targetedRefreshCooldownUntil.set(key, now + TARGETED_REFRESH_COOLDOWN_MS)

  const triggerSource = input.triggerSource ?? "post_transaction"
  const work = (async () => {
    try {
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
      })
    } catch (err) {
      console.warn("[accounting-snapshot] targeted refresh failed:", {
        business_id: businessId,
        period_start: periodStart,
        period_end: periodEnd,
        trigger_source: triggerSource,
        error: err instanceof Error ? err.message.slice(0, 300) : "unknown_error",
      })
    } finally {
      targetedRefreshInFlight.delete(key)
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
  } else {
    void work
  }

  return { scheduled: true, reason: "scheduled" }
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
  const { data, error } = await supabase.rpc("enqueue_accounting_snapshot_refresh_job", {
    p_business_id: input.businessId,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
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
