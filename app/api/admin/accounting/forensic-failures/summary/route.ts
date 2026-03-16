import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/requireFirmMember"
import { canAccessForensicMonitoring } from "@/lib/forensicMonitoringAuth"

/**
 * GET /api/admin/accounting/forensic-failures/summary
 * Query: run_id (required).
 * Returns counts by status: open, acknowledged, resolved, ignored.
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

    const runId = new URL(request.url).searchParams.get("run_id")
    if (!runId) {
      return NextResponse.json(
        { error: "Missing required parameter: run_id" },
        { status: 400 }
      )
    }

    const { data: rows, error } = await supabase
      .from("accounting_invariant_failures")
      .select("status")
      .eq("run_id", runId)

    if (error) {
      console.error("Forensic failures summary error:", error)
      return NextResponse.json(
        { error: error.message || "Failed to fetch summary" },
        { status: 500 }
      )
    }

    const counts = {
      open: 0,
      acknowledged: 0,
      resolved: 0,
      ignored: 0,
    }
    for (const r of rows ?? []) {
      if (r.status in counts) {
        counts[r.status as keyof typeof counts]++
      }
    }

    return NextResponse.json({ run_id: runId, ...counts })
  } catch (err: unknown) {
    console.error("Forensic failures summary:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
