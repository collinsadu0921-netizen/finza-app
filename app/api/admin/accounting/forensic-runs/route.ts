import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/requireFirmMember"
import { canAccessForensicMonitoring } from "@/lib/forensicMonitoringAuth"

const PAGE_SIZE = 20

/**
 * GET /api/admin/accounting/forensic-runs
 * Read-only. Paginated list of accounting_invariant_runs.
 * Query: page (default 1), limit (default 20, max 100).
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

    const forbidden = await requireFirmMemberForApi(supabase, user.id)
    if (forbidden) return forbidden

    const allowed = await canAccessForensicMonitoring(supabase, user.id)
    if (!allowed) {
      return NextResponse.json(
        { error: "Forbidden. Only Owner, Firm Admin, or Accounting Admin can access forensic monitoring." },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? String(PAGE_SIZE), 10) || PAGE_SIZE))
    const offset = (page - 1) * limit

    const { data: runs, error } = await supabase
      .from("accounting_invariant_runs")
      .select("id, started_at, finished_at, status, summary, alert_sent, created_at")
      .order("started_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error("Forensic runs list error:", error)
      return NextResponse.json(
        { error: error.message || "Failed to fetch forensic runs" },
        { status: 500 }
      )
    }

    const { count } = await supabase
      .from("accounting_invariant_runs")
      .select("id", { count: "exact", head: true })

    return NextResponse.json({
      runs: runs ?? [],
      total: count ?? 0,
      page,
      limit,
    })
  } catch (err: unknown) {
    console.error("Forensic runs list:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
