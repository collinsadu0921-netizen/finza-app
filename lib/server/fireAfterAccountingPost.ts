/**
 * Non-blocking wrapper around afterAccountingPost for mutation routes.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import { afterAccountingPost } from "@/lib/server/afterAccountingPost"

export function fireAfterAccountingPost(input: {
  businessId: string
  journalDate?: string | null
  periodStart?: string | null
  periodEnd?: string | null
  source: string
  supabase?: SupabaseClient
  scheduleBackground?: (promise: Promise<unknown>) => void
}): void {
  const work = afterAccountingPost(input).catch((err) => {
    console.warn(
      "[after-accounting-post] non-blocking failure:",
      err instanceof Error ? err.message.slice(0, 200) : "unknown"
    )
  })
  if (input.scheduleBackground) {
    try {
      input.scheduleBackground(work)
      return
    } catch {
      // fall through
    }
  }
  void work
}
