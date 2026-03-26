import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"

/**
 * GET /api/accounting/reversal/status
 *
 * Query params: business_id, je_ids (comma-separated list of journal entry ids)
 * Returns for each JE: can_reverse, reason (if blocked), reversal_je_id (if already reversed).
 * Used by ledger UI to disable Reverse button and show tooltips.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")?.trim()
    const jeIdsParam = searchParams.get("je_ids")
    const jeIds = jeIdsParam
      ? jeIdsParam.split(",").map((id) => id.trim()).filter(Boolean)
      : []

    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Forbidden"
      return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
    }

    const resolved = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams,
      pathname: new URL(request.url).pathname,
      source: "api",
    })
    if ("error" in resolved) {
      return NextResponse.json(
        { error: "business_id is required" },
        { status: 400 }
      )
    }
    const resolvedBusinessId = resolved.businessId

    const authResult = await checkAccountingAuthority(supabase, user.id, resolvedBusinessId, "read")
    if (!authResult.authorized) {
      return NextResponse.json(
        { error: "You do not have permission to view this business." },
        { status: 403 }
      )
    }

    const statuses: Record<string, { can_reverse: boolean; reason?: string; reversal_je_id?: string }> = {}

    if (jeIds.length === 0) {
      return NextResponse.json({ statuses })
    }

    const { data: entries } = await supabase
      .from("journal_entries")
      .select("id, business_id, date")
      .eq("business_id", resolvedBusinessId)
      .in("id", jeIds)

    const entryMap = new Map((entries || []).map((e) => [e.id, e]))

    const { data: reversals } = await supabase
      .from("journal_entries")
      .select("id, reference_id")
      .eq("business_id", resolvedBusinessId)
      .eq("reference_type", "reversal")
      .in("reference_id", jeIds)

    const reversedOriginalToReversal = new Map(
      (reversals || []).map((r) => [r.reference_id as string, r.id as string])
    )

    const today = new Date().toISOString().slice(0, 10)
    const { data: periods } = await supabase
      .from("accounting_periods")
      .select("id, status, period_start, period_end")
      .eq("business_id", resolvedBusinessId)

    const openPeriodRanges: Array<{ start: string; end: string }> = (periods || [])
      .filter((p) => p.status === "open")
      .map((p) => ({
        start: String(p.period_start).slice(0, 10),
        end: String(p.period_end).slice(0, 10),
      }))

    const hasOpenPeriodContainingToday = openPeriodRanges.some(
      (r) => today >= r.start && today <= r.end
    )

    for (const jeId of jeIds) {
      const entry = entryMap.get(jeId)
      if (!entry) {
        statuses[jeId] = { can_reverse: false, reason: "Journal entry not found" }
        continue
      }

      const existingReversalId = reversedOriginalToReversal.get(jeId)
      if (existingReversalId) {
        statuses[jeId] = {
          can_reverse: false,
          reason: "This entry has already been reversed.",
          reversal_je_id: existingReversalId,
        }
        continue
      }

      if (!hasOpenPeriodContainingToday) {
        statuses[jeId] = { can_reverse: false, reason: "Current period is closed. Reversals are only allowed in an open period." }
        continue
      }

      statuses[jeId] = { can_reverse: true }
    }

    return NextResponse.json({ statuses })
  } catch (err: unknown) {
    console.error("Reversal status API error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
