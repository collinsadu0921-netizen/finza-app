import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/accounting/firm/requireMember"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"
import { resolveWorkFirmId } from "@/lib/practice/work/scope"
import {
  canManageClientAssignments,
  isPracticeFirmRole,
} from "@/lib/practice/assignment/policy"
import { loadMembership } from "@/lib/practice/assignment/scope"

type RouteContext = { params: Promise<{ id: string }> }

function displayName(row: { full_name?: string | null; email?: string | null }): string {
  return row.full_name?.trim() || row.email?.trim() || "Firm user"
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: businessId } = await context.params
    if (!businessId) return NextResponse.json({ error: "Missing client id" }, { status: 400 })

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const forbidden = await requireFirmMemberForApi(supabase, user.id)
    if (forbidden) return forbidden

    const requestedFirmId = request.nextUrl.searchParams.get("firm_id")
    const { data: memberships } = await supabase
      .from("accounting_firm_users")
      .select("firm_id, role")
      .eq("user_id", user.id)
    const resolved = resolveWorkFirmId({
      memberships: memberships ?? [],
      requestedFirmId,
    })
    if (!resolved.firmId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const membership = await loadMembership(supabase, user.id, resolved.firmId)
    if (!membership || !isPracticeFirmRole(membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const auth = await getAccountingAuthority({
      supabase,
      firmUserId: user.id,
      businessId,
      requiredLevel: "read",
    })
    if (!auth.allowed && !canManageClientAssignments(membership.role)) {
      return NextResponse.json({ error: "Forbidden", reason: auth.reason }, { status: 403 })
    }
    if (auth.allowed && auth.firmId && auth.firmId !== resolved.firmId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const [{ data: staffRows }, { data: assignmentRows }] = await Promise.all([
      supabase
        .from("accounting_firm_users")
        .select("user_id, role")
        .eq("firm_id", resolved.firmId),
      supabase
        .from("accounting_firm_client_assignments")
        .select("user_id, assigned_at")
        .eq("firm_id", resolved.firmId)
        .eq("client_business_id", businessId)
        .is("unassigned_at", null),
    ])

    const userIds = [...new Set((staffRows ?? []).map((row) => row.user_id as string))]
    const { data: users } = userIds.length
      ? await supabase.from("users").select("id, email, full_name").in("id", userIds)
      : { data: [] }
    const names = new Map((users ?? []).map((row) => [row.id, displayName(row)]))
    const assignedIds = new Set((assignmentRows ?? []).map((row) => row.user_id as string))

    const staff = (staffRows ?? []).map((row) => ({
      user_id: row.user_id,
      role: row.role,
      name: names.get(row.user_id) ?? "Firm user",
      assigned: assignedIds.has(row.user_id),
    }))

    return NextResponse.json({
      firm_id: resolved.firmId,
      can_manage: canManageClientAssignments(membership.role),
      staff,
    })
  } catch (e) {
    console.error("GET assignments:", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : "Internal server error" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id: businessId } = await context.params
    if (!businessId) return NextResponse.json({ error: "Missing client id" }, { status: 400 })

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const forbidden = await requireFirmMemberForApi(supabase, user.id)
    if (forbidden) return forbidden

    const body = await request.json().catch(() => ({}))
    const requestedFirmId = typeof body.firm_id === "string" ? body.firm_id.trim() : ""
    const userIds: string[] = []
    if (Array.isArray(body.user_ids)) {
      const seen = new Set<string>()
      for (const id of body.user_ids) {
        if (typeof id !== "string") continue
        const trimmed = id.trim()
        if (!trimmed || seen.has(trimmed)) continue
        seen.add(trimmed)
        userIds.push(trimmed)
      }
    }

    const membership = await loadMembership(supabase, user.id, requestedFirmId || null)
    if (!membership || !isPracticeFirmRole(membership.role) || !canManageClientAssignments(membership.role)) {
      return NextResponse.json({ error: "Only partners can manage assignments" }, { status: 403 })
    }
    const firmId = membership.firm_id

    const { data: engagement } = await supabase
      .from("firm_client_engagements")
      .select("id, status")
      .eq("accounting_firm_id", firmId)
      .eq("client_business_id", businessId)
      .in("status", ["pending", "accepted", "active", "suspended"])
      .limit(1)
      .maybeSingle()
    if (!engagement) {
      return NextResponse.json({ error: "Assignment requires a valid firm-client engagement" }, { status: 403 })
    }

    if (userIds.length) {
      const { data: sameFirm } = await supabase
        .from("accounting_firm_users")
        .select("user_id")
        .eq("firm_id", firmId)
        .in("user_id", userIds)
      const allowed = new Set((sameFirm ?? []).map((row) => row.user_id as string))
      if (userIds.some((id) => !allowed.has(id))) {
        return NextResponse.json({ error: "Cannot assign a user from another firm" }, { status: 403 })
      }
    }

    const { data: current } = await supabase
      .from("accounting_firm_client_assignments")
      .select("id, user_id")
      .eq("firm_id", firmId)
      .eq("client_business_id", businessId)
      .is("unassigned_at", null)

    const currentIds = new Set((current ?? []).map((row) => row.user_id as string))
    const nextIds = new Set(userIds)
    const toAdd = userIds.filter((id) => !currentIds.has(id))
    const toRemove = [...currentIds].filter((id) => !nextIds.has(id))

    if (toRemove.length) {
      await supabase
        .from("accounting_firm_client_assignments")
        .update({ unassigned_at: new Date().toISOString() })
        .eq("firm_id", firmId)
        .eq("client_business_id", businessId)
        .in("user_id", toRemove)
        .is("unassigned_at", null)
    }

    if (toAdd.length) {
      const { error: insertErr } = await supabase.from("accounting_firm_client_assignments").insert(
        toAdd.map((id) => ({
          firm_id: firmId,
          client_business_id: businessId,
          user_id: id,
          assigned_by_user_id: user.id,
        }))
      )
      if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 400 })
      }
    }

    for (const targetUserId of toAdd) {
      await logFirmActivity({
        supabase,
        firmId,
        actorUserId: user.id,
        actionType: "client_staff_assigned",
        entityType: "client_assignment",
        entityId: businessId,
        metadata: { client_business_id: businessId, target_user_id: targetUserId, action: "assigned" },
      })
    }
    for (const targetUserId of toRemove) {
      await logFirmActivity({
        supabase,
        firmId,
        actorUserId: user.id,
        actionType: "client_staff_unassigned",
        entityType: "client_assignment",
        entityId: businessId,
        metadata: { client_business_id: businessId, target_user_id: targetUserId, action: "unassigned" },
      })
    }

    return NextResponse.json({ ok: true, assigned: userIds })
  } catch (e) {
    console.error("PUT assignments:", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : "Internal server error" }, { status: 500 })
  }
}
