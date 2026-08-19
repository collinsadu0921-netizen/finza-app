import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requirePartnerForFirmApi } from "@/lib/accounting/firm/requirePartner"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"
import { toSafeStaffInvitation } from "@/lib/accounting/firm/staffInvitations"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const requestedFirmId = typeof body.firm_id === "string" ? body.firm_id : null

    const { data: existing, error: lookupErr } = await supabase
      .from("accounting_firm_staff_invitations")
      .select("id, firm_id, email_normalized, role, status")
      .eq("id", id)
      .maybeSingle()

    if (lookupErr) throw lookupErr
    if (!existing) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 })
    }
    if (existing.status !== "pending") {
      return NextResponse.json({ error: "Only pending invitations can be revoked." }, { status: 409 })
    }

    const partnerCheck = await requirePartnerForFirmApi(
      supabase,
      user.id,
      requestedFirmId ?? existing.firm_id
    )
    if (partnerCheck instanceof NextResponse) return partnerCheck
    if (partnerCheck.firmId !== existing.firm_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const revokedAt = new Date().toISOString()
    const { data: updated, error: updateErr } = await supabase
      .from("accounting_firm_staff_invitations")
      .update({
        status: "revoked",
        revoked_at: revokedAt,
        updated_at: revokedAt,
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("id, firm_id, email_normalized, role, status, expires_at, created_at, accepted_at, revoked_at")
      .single()

    if (updateErr) throw updateErr

    await logFirmActivity({
      supabase,
      firmId: existing.firm_id,
      actorUserId: user.id,
      actionType: "firm_staff_invitation_revoked",
      entityType: "firm_staff_invitation",
      entityId: id,
      metadata: { role: existing.role, invitation_id: id },
    })

    return NextResponse.json({ invitation: toSafeStaffInvitation(updated) })
  } catch (e) {
    console.error("POST /api/accounting/firm/staff/invitations/[id]/revoke:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
