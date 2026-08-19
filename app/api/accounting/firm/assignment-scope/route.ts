import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/accounting/firm/requireMember"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"
import {
  canManageAssignmentEnforcement,
  isPracticeFirmRole,
} from "@/lib/practice/assignment/policy"
import { resolveActivePracticeFirmScope } from "@/lib/practice/assignment/activeFirm"
import { loadMembership } from "@/lib/practice/assignment/scope"

function displayName(row: { full_name?: string | null; email?: string | null }): string {
  return row.full_name?.trim() || row.email?.trim() || "Firm user"
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const forbidden = await requireFirmMemberForApi(supabase, user.id)
    if (forbidden) return forbidden

    const resolved = await resolveActivePracticeFirmScope({
      supabase,
      userId: user.id,
      requestedFirmId: request.nextUrl.searchParams.get("firm_id"),
    })
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }

    const { data: staffRows } = await supabase
      .from("accounting_firm_users")
      .select("user_id, role")
      .eq("firm_id", resolved.firmId)
    const { data: assignments } = await supabase
      .from("accounting_firm_client_assignments")
      .select("user_id, client_business_id")
      .eq("firm_id", resolved.firmId)
      .is("unassigned_at", null)

    const effective = new Set(resolved.scope.effectiveBusinessIds)
    const assignedByUser = new Map<string, Set<string>>()
    for (const row of assignments ?? []) {
      const set = assignedByUser.get(row.user_id) ?? new Set<string>()
      if (effective.has(row.client_business_id)) set.add(row.client_business_id)
      assignedByUser.set(row.user_id, set)
    }

    const userIds = (staffRows ?? []).map((row) => row.user_id as string)
    const { data: users } = userIds.length
      ? await supabase.from("users").select("id, email, full_name").in("id", userIds)
      : { data: [] }
    const names = new Map((users ?? []).map((row) => [row.id, displayName(row)]))

    const restricted_staff = (staffRows ?? [])
      .filter((row) => row.role !== "partner")
      .map((row) => ({
        user_id: row.user_id,
        role: row.role,
        name: names.get(row.user_id) ?? "Firm user",
        assigned_count: assignedByUser.get(row.user_id)?.size ?? 0,
      }))

    return NextResponse.json({
      firm_id: resolved.firmId,
      enabled: resolved.scope.enforcementActive,
      can_manage: canManageAssignmentEnforcement(resolved.scope.role),
      effective_client_count: resolved.scope.effectiveBusinessIds.length,
      restricted_staff,
    })
  } catch (e) {
    console.error("GET assignment-scope:", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const forbidden = await requireFirmMemberForApi(supabase, user.id)
    if (forbidden) return forbidden

    const body = await request.json().catch(() => ({}))
    const requestedFirmId = typeof body.firm_id === "string" ? body.firm_id.trim() : ""
    const enabled = body.enabled === true
    if (!requestedFirmId) {
      return NextResponse.json({ error: "firm_id is required" }, { status: 400 })
    }

    const membership = await loadMembership(supabase, user.id, requestedFirmId)
    if (!membership || !isPracticeFirmRole(membership.role) || !canManageAssignmentEnforcement(membership.role)) {
      return NextResponse.json({ error: "Only partners can change assignment enforcement" }, { status: 403 })
    }

    const now = new Date().toISOString()
    const { error } = await supabase
      .from("accounting_firms")
      .update({
        assignment_scope_enabled_at: enabled ? now : null,
        assignment_scope_enabled_by: enabled ? user.id : null,
      })
      .eq("id", membership.firm_id)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    await logFirmActivity({
      supabase,
      firmId: membership.firm_id,
      actorUserId: user.id,
      actionType: enabled ? "assignment_scope_enabled" : "assignment_scope_disabled",
      entityType: "assignment_scope",
      entityId: membership.firm_id,
      metadata: { enabled },
    })

    return NextResponse.json({ ok: true, firm_id: membership.firm_id, enabled })
  } catch (e) {
    console.error("POST assignment-scope:", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : "Internal server error" }, { status: 500 })
  }
}
