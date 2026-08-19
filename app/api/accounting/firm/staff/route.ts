import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/accounting/firm/requireMember"
import { resolveWorkFirmId } from "@/lib/practice/work/scope"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const forbidden = await requireFirmMemberForApi(supabase, user.id)
    if (forbidden) return forbidden

    const { data: memberships } = await supabase
      .from("accounting_firm_users")
      .select("firm_id")
      .eq("user_id", user.id)
    const resolved = resolveWorkFirmId({
      memberships: memberships ?? [],
      requestedFirmId: request.nextUrl.searchParams.get("firm_id"),
    })
    if (!resolved.firmId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const [{ data: staffRows }, { data: assignments }] = await Promise.all([
      supabase.from("accounting_firm_users").select("user_id, role").eq("firm_id", resolved.firmId),
      supabase
        .from("accounting_firm_client_assignments")
        .select("user_id")
        .eq("firm_id", resolved.firmId)
        .is("unassigned_at", null),
    ])

    const counts = new Map<string, number>()
    for (const row of assignments ?? []) {
      counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1)
    }

    const userIds = (staffRows ?? []).map((row) => row.user_id as string)
    const { data: users } = userIds.length
      ? await supabase.from("users").select("id, email, full_name").in("id", userIds)
      : { data: [] }
    const names = new Map(
      (users ?? []).map((row) => [row.id, row.full_name?.trim() || row.email?.trim() || "Firm user"])
    )

    const staff = (staffRows ?? []).map((row) => ({
      user_id: row.user_id,
      role: row.role,
      name: names.get(row.user_id) ?? "Firm user",
      assigned_client_count: counts.get(row.user_id) ?? 0,
    }))

    return NextResponse.json({ firm_id: resolved.firmId, staff })
  } catch (e) {
    console.error("GET /api/accounting/firm/staff:", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : "Internal server error" }, { status: 500 })
  }
}
