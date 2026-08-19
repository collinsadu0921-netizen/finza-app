/**
 * GET /api/accounting/dashboard
 *
 * One request Practice home read model for the active firm.
 * Reuses the Work index + authorized client scope. No per-client N+1.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/accounting/firm/requireMember"
import { loadPracticeDashboard } from "@/lib/practice/dashboard/load"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const forbidden = await requireFirmMemberForApi(supabase, user.id)
    if (forbidden) return forbidden

    const result = await loadPracticeDashboard({
      supabase,
      userId: user.id,
      requestedFirmId: request.nextUrl.searchParams.get("firm_id"),
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({
      ...result.dashboard,
      architecture: "practice_dashboard_read_model",
    })
  } catch (err) {
    console.error("GET /api/accounting/dashboard:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
