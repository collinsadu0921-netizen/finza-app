import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/requireFirmMember"
import { canAccessForensicMonitoring } from "@/lib/forensicMonitoringAuth"

const PAGE_SIZE = 25

/**
 * GET /api/admin/accounting/forensic-failures
 * Read-only. Paginated list; payload excluded by default for performance.
 * Query: run_id (required), check_id?, business_id?, severity?, status?, page?, limit?, include_payload=1?
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
    const runId = searchParams.get("run_id")
    const checkId = searchParams.get("check_id")
    const businessId = searchParams.get("business_id")
    const severity = searchParams.get("severity")
    const status = searchParams.get("status")
    const includePayload = searchParams.get("include_payload") === "1"
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? String(PAGE_SIZE), 10) || PAGE_SIZE))
    const offset = (page - 1) * limit

    if (!runId) {
      return NextResponse.json(
        { error: "Missing required parameter: run_id" },
        { status: 400 }
      )
    }

    const selectFields = includePayload
      ? "id, run_id, check_id, business_id, severity, status, acknowledged_by, acknowledged_at, resolved_by, resolved_at, resolution_note, payload, created_at"
      : "id, run_id, check_id, business_id, severity, status, acknowledged_by, acknowledged_at, resolved_by, resolved_at, resolution_note, created_at"

    let query = supabase
      .from("accounting_invariant_failures")
      .select(selectFields, { count: "exact" })
      .eq("run_id", runId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (checkId) query = query.eq("check_id", checkId)
    if (businessId) query = query.eq("business_id", businessId)
    if (severity) query = query.eq("severity", severity)
    if (status) query = query.eq("status", status)

    const { data: failures, error, count } = await query

    if (error) {
      console.error("Forensic failures list error:", error)
      return NextResponse.json(
        { error: error.message || "Failed to fetch failures" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      failures: failures ?? [],
      total: count ?? 0,
      page,
      limit,
    })
  } catch (err: unknown) {
    console.error("Forensic failures list:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
