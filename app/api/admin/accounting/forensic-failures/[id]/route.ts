import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/requireFirmMember"
import { canAccessForensicMonitoring } from "@/lib/forensicMonitoringAuth"

/**
 * GET /api/admin/accounting/forensic-failures/[id]
 * Read-only. Single failure including full payload (for expand/drill).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: "Missing failure id" }, { status: 400 })
    }

    const { data: failure, error } = await supabase
      .from("accounting_invariant_failures")
      .select("id, run_id, check_id, business_id, severity, status, acknowledged_by, acknowledged_at, resolved_by, resolved_at, resolution_note, payload, created_at")
      .eq("id", id)
      .maybeSingle()

    if (error) {
      console.error("Forensic failure detail error:", error)
      return NextResponse.json(
        { error: error.message || "Failed to fetch failure" },
        { status: 500 }
      )
    }

    if (!failure) {
      return NextResponse.json({ error: "Failure not found" }, { status: 404 })
    }

    return NextResponse.json({ failure })
  } catch (err: unknown) {
    console.error("Forensic failure detail:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
