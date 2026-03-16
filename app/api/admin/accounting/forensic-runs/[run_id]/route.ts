import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/requireFirmMember"
import { canAccessForensicMonitoring } from "@/lib/forensicMonitoringAuth"

/**
 * GET /api/admin/accounting/forensic-runs/[run_id]
 * Read-only. Single run with full summary.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ run_id: string }> }
) {
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

    const { run_id } = await params
    if (!run_id) {
      return NextResponse.json({ error: "Missing run_id" }, { status: 400 })
    }

    const { data: run, error } = await supabase
      .from("accounting_invariant_runs")
      .select("id, started_at, finished_at, status, summary, alert_sent, created_at")
      .eq("id", run_id)
      .maybeSingle()

    if (error) {
      console.error("Forensic run detail error:", error)
      return NextResponse.json(
        { error: error.message || "Failed to fetch run" },
        { status: 500 }
      )
    }

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 })
    }

    return NextResponse.json({ run })
  } catch (err: unknown) {
    console.error("Forensic run detail:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
