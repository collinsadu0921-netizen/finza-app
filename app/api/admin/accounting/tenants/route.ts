import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/requireFirmMember"
import { canAccessForensicMonitoring } from "@/lib/forensicMonitoringAuth"

const PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/admin/accounting/tenants
 * List businesses (paginated; optional search by name or id).
 * Admin-only: same access as forensic monitoring (Owner, Firm Admin, Accounting Admin).
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
        { error: "Forbidden. Only Owner, Firm Admin, or Accounting Admin can access tenant management." },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(searchParams.get("page_size") ?? String(PAGE_SIZE), 10) || PAGE_SIZE)
    )
    const search = searchParams.get("search")?.trim() ?? ""

    let query = supabase
      .from("businesses")
      .select("id, name, owner_id, created_at, archived_at", { count: "exact" })
      .order("created_at", { ascending: false })

    if (search) {
      if (UUID_REGEX.test(search)) {
        query = query.eq("id", search)
      } else {
        const escaped = search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
        query = query.ilike("name", `%${escaped}%`)
      }
    }

    const from = (page - 1) * pageSize
    const to = from + pageSize - 1
    const { data: tenants, error, count } = await query.range(from, to)

    if (error) {
      console.error("Admin tenants list error:", error)
      return NextResponse.json(
        { error: error.message || "Failed to fetch tenants" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      tenants: tenants ?? [],
      total: count ?? 0,
      page,
      page_size: pageSize,
    })
  } catch (err: unknown) {
    console.error("Admin tenants list:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
