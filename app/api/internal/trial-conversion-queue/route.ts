import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { isInternalOpsAdmin } from "@/lib/internalAnnouncementsAdmin"
import { buildTrialConversionQueue } from "@/lib/growth/trialConversionQueue"

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
  if (!raw) return 25
  return Math.min(Math.max(parseInt(raw, 10) || 25, 1), 50)
}

function parsePage(raw: string | null): number {
  if (!raw) return 1
  return Math.max(parseInt(raw, 10) || 1, 1)
}

function parseFilter(raw: string | null): TrialConversionFilter {
  return FILTERS.includes(raw as TrialConversionFilter) ? (raw as TrialConversionFilter) : "all_unpaid"
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
  const page = parsePage(request.nextUrl.searchParams.get("page"))
  const trialingOnlyParam = request.nextUrl.searchParams.get("trialing_only") === "1"
  const filter = parseFilter(request.nextUrl.searchParams.get("filter"))

  try {
    const result = await buildTrialConversionQueue(admin, {
      limit,
      page,
      filter: trialingOnlyParam ? "trialing_only" : filter,
      trialingOnly: trialingOnlyParam,
    })
    console.info(
      "[internal/trial-conversion-queue]",
      JSON.stringify({
        filter,
        page: result.meta.page,
        page_size: result.meta.page_size,
        count: result.rows.length,
        total: result.total,
        duration_ms: result.meta.duration_ms,
        auth_admin_calls: result.meta.auth_admin_calls,
        business_query_count: result.meta.business_query_count,
        activation_event_query_count: result.meta.activation_event_query_count,
        scan_truncated: result.meta.scan_truncated,
      })
    )
    return NextResponse.json({
      ok: true,
      filter,
      count: result.rows.length,
      total: result.total,
      page: result.meta.page,
      page_size: result.meta.page_size,
      queue: result.rows,
      meta: result.meta,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
