import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requirePartnerForFirmApi } from "@/lib/accounting/firm/requirePartner"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"
import { sendPracticeStaffInvitationEmail } from "@/lib/email/sendPracticeStaffInvitationEmail"
import {
  generateInvitationToken,
  invitationExpiresAt,
  toSafeStaffInvitation,
  type PracticeStaffRole,
} from "@/lib/accounting/firm/staffInvitations"

function getAppOrigin(request: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "")
  return env || request.nextUrl.origin.replace(/\/$/, "")
}

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
      return NextResponse.json({ error: "Only pending invitations can be resent." }, { status: 409 })
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

    const { token, tokenHash } = generateInvitationToken()
    const expiresAt = invitationExpiresAt()

    const { data: updated, error: updateErr } = await supabase
      .from("accounting_firm_staff_invitations")
      .update({
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("id, firm_id, email_normalized, role, status, expires_at, created_at, accepted_at, revoked_at")
      .single()

    if (updateErr) throw updateErr

    const [{ data: firm }, { data: inviter }] = await Promise.all([
      supabase.from("accounting_firms").select("name").eq("id", existing.firm_id).maybeSingle(),
      supabase.from("users").select("full_name, email").eq("id", user.id).maybeSingle(),
    ])

    const partnerName =
      inviter?.full_name?.trim() ||
      inviter?.email?.trim() ||
      user.email?.trim() ||
      "A partner"
    const firmName = firm?.name?.trim() || "your firm"
    const acceptUrl = `${getAppOrigin(request)}/accounting/invitations/accept?token=${encodeURIComponent(token)}`

    const emailResult = await sendPracticeStaffInvitationEmail({
      to: existing.email_normalized,
      partnerName,
      firmName,
      role: existing.role as PracticeStaffRole,
      acceptUrl,
      expiresAt,
    })

    await logFirmActivity({
      supabase,
      firmId: existing.firm_id,
      actorUserId: user.id,
      actionType: "firm_staff_invitation_resent",
      entityType: "firm_staff_invitation",
      entityId: id,
      metadata: { role: existing.role, invitation_id: id },
    })

    const responseBody: Record<string, unknown> = {
      invitation: toSafeStaffInvitation(updated),
      email_sent: emailResult.success,
    }
    if (!emailResult.success) {
      responseBody.email_error = "Invitation updated, but email could not be sent. Try again."
    }

    return NextResponse.json(responseBody)
  } catch (e) {
    console.error("POST /api/accounting/firm/staff/invitations/[id]/resend:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
