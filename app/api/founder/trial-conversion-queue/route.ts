import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { isInternalOpsAdmin } from "@/lib/internalAnnouncementsAdmin"
import { buildTrialConversionQueue } from "@/lib/growth/trialConversionQueue"

export const dynamic = "force-dynamic"

/**
 * GET /api/founder/trial-conversion-queue
 * Back-compat API for trial conversion queue with WhatsApp action links.
 * Uses the shared internal ops gate; new UI uses /api/internal/trial-conversion-queue.
 *
 * Query params:
 *   limit — max rows (default 100)
 *   trialing_only — "1" to filter unpaid trial funnel
 */
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

  const limitRaw = request.nextUrl.searchParams.get("limit")
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 100, 1), 500) : 100
  const trialingOnly = request.nextUrl.searchParams.get("trialing_only") === "1"

  try {
    const queue = await buildTrialConversionQueue(admin, {
      limit,
      trialingOnly,
    })
    return NextResponse.json({ ok: true, count: queue.length, queue })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
