/**
 * Shared post-accounting mutation helper.
 * Fire-and-forget: never blocks mutation success on snapshot rebuild.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import { invalidateAccountingCachesForBusiness } from "@/lib/server/accountingSnapshotCacheInvalidation"
import { scheduleTargetedSnapshotRefresh } from "@/lib/server/accountingSnapshotRefresh"

export type AfterAccountingPostInput = {
  businessId: string
  /** Journal / document date (YYYY-MM-DD). Used to resolve the accounting period. */
  journalDate?: string | null
  periodStart?: string | null
  periodEnd?: string | null
  source?: string
  supabase?: SupabaseClient
  scheduleBackground?: (promise: Promise<unknown>) => void
}

async function resolvePeriod(
  supabase: SupabaseClient,
  businessId: string,
  journalDate: string
): Promise<{ periodStart: string; periodEnd: string } | null> {
  const { data, error } = await supabase.rpc("finza_resolve_accounting_period_for_date", {
    p_business_id: businessId,
    p_journal_date: journalDate,
  })
  if (error) {
    console.warn("[after-accounting-post] period resolve failed:", error.message)
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== "object") return null
  const periodStart = String((row as { period_start?: string }).period_start ?? "")
  const periodEnd = String((row as { period_end?: string }).period_end ?? "")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    return null
  }
  return { periodStart, periodEnd }
}

/**
 * After a successful accounting mutation: invalidate app caches and schedule
 * targeted snapshot refresh when enabled. Durable enqueue is owned by DB triggers.
 */
export async function afterAccountingPost(input: AfterAccountingPostInput): Promise<{
  scheduled: boolean
  reason: string
  periodStart?: string
  periodEnd?: string
}> {
  const businessId = input.businessId?.trim()
  if (!businessId) {
    return { scheduled: false, reason: "missing_business_id" }
  }

  try {
    await invalidateAccountingCachesForBusiness(businessId)
  } catch (err) {
    console.warn(
      "[after-accounting-post] cache invalidation failed:",
      err instanceof Error ? err.message : String(err)
    )
  }

  let periodStart = input.periodStart?.trim() || ""
  let periodEnd = input.periodEnd?.trim() || ""

  if ((!periodStart || !periodEnd) && input.journalDate && input.supabase) {
    const resolved = await resolvePeriod(input.supabase, businessId, input.journalDate)
    if (resolved) {
      periodStart = resolved.periodStart
      periodEnd = resolved.periodEnd
    }
  }

  if (!periodStart || !periodEnd) {
    // Still invalidated caches; durable queue covers refresh via journal trigger.
    return { scheduled: false, reason: "period_unresolved", periodStart, periodEnd }
  }

  const scheduled = scheduleTargetedSnapshotRefresh({
    businessId,
    periodStart,
    periodEnd,
    triggerSource: "post_transaction",
    scheduleBackground: input.scheduleBackground,
  })

  console.info("[after-accounting-post]", {
    business_id: businessId,
    period_start: periodStart,
    period_end: periodEnd,
    trigger_source: "post_transaction",
    source: input.source ?? null,
    scheduled: scheduled.scheduled,
    reason: scheduled.reason,
  })

  return {
    scheduled: scheduled.scheduled,
    reason: scheduled.reason,
    periodStart,
    periodEnd,
  }
}
