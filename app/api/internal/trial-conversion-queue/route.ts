import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { isInternalOpsAdmin } from "@/lib/internalAnnouncementsAdmin"
import {
  buildTrialConversionQueue,
  type TrialConversionQueueRow,
} from "@/lib/growth/trialConversionQueue"

export const dynamic = "force-dynamic"

const FILTERS = [
  "all_unpaid",
  "trialing_only",
  "ending_soon",
  "expired_unpaid",
  "no_activation",
  "invoice_no_payment",
  "pricing_viewed",
  "consent_yes",
  "consent_missing",
] as const

type TrialConversionFilter = (typeof FILTERS)[number]

function parseLimit(raw: string | null): number {
  if (!raw) return 100
  return Math.min(Math.max(parseInt(raw, 10) || 100, 1), 500)
}

function parseFilter(raw: string | null): TrialConversionFilter {
  return FILTERS.includes(raw as TrialConversionFilter) ? (raw as TrialConversionFilter) : "all_unpaid"
}

function hasEvent(row: TrialConversionQueueRow, eventName: string): boolean {
  return row.activation_events.includes(eventName)
}

function filterRows(
  rows: TrialConversionQueueRow[],
  filter: TrialConversionFilter,
  trialingOnlyParam: boolean
): TrialConversionQueueRow[] {
  const now = Date.now()
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000

  return rows.filter((row) => {
    if (row.is_paid) return false

    if (trialingOnlyParam && !["trialing", "past_due", "locked"].includes(row.trial_status ?? "")) {
      return false
    }

    switch (filter) {
      case "trialing_only":
        return row.trial_status === "trialing"
      case "ending_soon": {
        if (row.trial_status !== "trialing" || !row.trial_ends_at) return false
        const endsAt = new Date(row.trial_ends_at).getTime()
        return Number.isFinite(endsAt) && endsAt >= now && endsAt <= now + threeDaysMs
      }
      case "expired_unpaid": {
        if (!row.trial_ends_at) return row.trial_status === "past_due" || row.trial_status === "locked"
        const endsAt = new Date(row.trial_ends_at).getTime()
        return (
          (Number.isFinite(endsAt) && endsAt <= now) ||
          row.trial_status === "past_due" ||
          row.trial_status === "locked"
        )
      }
      case "no_activation":
        return !hasEvent(row, "customer_created") && !hasEvent(row, "invoice_created")
      case "invoice_no_payment":
        return hasEvent(row, "invoice_created") && !hasEvent(row, "payment_recorded")
      case "pricing_viewed":
        return hasEvent(row, "pricing_viewed")
      case "consent_yes":
        return row.trial_contact_consent === true
      case "consent_missing":
        return row.trial_contact_consent !== true
      case "all_unpaid":
      default:
        return true
    }
  })
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!isInternalOpsAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const admin = getSupabaseServiceRoleClient()
  if (!admin) {
    return NextResponse.json(
      { error: "Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing" },
      { status: 500 }
    )
  }

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"))
  const trialingOnlyParam = request.nextUrl.searchParams.get("trialing_only") === "1"
  const filter = parseFilter(request.nextUrl.searchParams.get("filter"))

  try {
    const queue = await buildTrialConversionQueue(admin, {
      limit,
      trialingOnly: trialingOnlyParam || filter === "trialing_only",
    })
    const filtered = filterRows(queue, filter, trialingOnlyParam)
    return NextResponse.json({
      ok: true,
      filter,
      count: filtered.length,
      queue: filtered,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
