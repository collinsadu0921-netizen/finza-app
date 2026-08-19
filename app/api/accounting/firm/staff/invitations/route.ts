import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requirePartnerForFirmApi } from "@/lib/accounting/firm/requirePartner"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"
import { sendPracticeStaffInvitationEmail } from "@/lib/email/sendPracticeStaffInvitationEmail"
import {
  generateInvitationToken,
  invitationExpiresAt,
  isExistingFirmMember,
  isValidPracticeStaffRole,
  normalizeInvitationEmail,
  toSafeStaffInvitation,
} from "@/lib/accounting/firm/staffInvitations"

function getAppOrigin(request: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "")
  return env || request.nextUrl.origin.replace(/\/$/, "")
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const partnerCheck = await requirePartnerForFirmApi(
      supabase,
      user.id,
      request.nextUrl.searchParams.get("firm_id")
    )
    if (partnerCheck instanceof NextResponse) return partnerCheck

    const { data: rows, error } = await supabase
      .from("accounting_firm_staff_invitations")
      .select("id, firm_id, email_normalized, role, status, expires_at, created_at, accepted_at, revoked_at")
      .eq("firm_id", partnerCheck.firmId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })

    if (error) throw error

    return NextResponse.json({
      firm_id: partnerCheck.firmId,
      invitations: (rows ?? []).map((row) => toSafeStaffInvitation(row)),
    })
  } catch (e) {
    console.error("GET /api/accounting/firm/staff/invitations:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const requestedFirmId = typeof body.firm_id === "string" ? body.firm_id : null
    const partnerCheck = await requirePartnerForFirmApi(supabase, user.id, requestedFirmId)
    if (partnerCheck instanceof NextResponse) return partnerCheck

    if (requestedFirmId && requestedFirmId !== partnerCheck.firmId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const emailRaw = typeof body.email === "string" ? body.email : ""
    const roleRaw = typeof body.role === "string" ? body.role : ""
    const emailNormalized = normalizeInvitationEmail(emailRaw)

    if (!isValidEmail(emailNormalized)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 })
    }
    if (!isValidPracticeStaffRole(roleRaw)) {
      return NextResponse.json(
        { error: "Role must be one of: partner, senior, junior, readonly" },
        { status: 400 }
      )
    }

    const alreadyMember = await isExistingFirmMember(
      supabase,
      partnerCheck.firmId,
      emailNormalized
    )
    if (alreadyMember) {
      return NextResponse.json(
        { error: "That person is already a member of this firm." },
        { status: 409 }
      )
    }

    const { data: pendingDuplicate } = await supabase
      .from("accounting_firm_staff_invitations")
      .select("id")
      .eq("firm_id", partnerCheck.firmId)
      .eq("email_normalized", emailNormalized)
      .eq("status", "pending")
      .maybeSingle()

    if (pendingDuplicate?.id) {
      return NextResponse.json(
        { error: "An invitation is already pending for this email." },
        { status: 409 }
      )
    }

    const { token, tokenHash } = generateInvitationToken()
    const expiresAt = invitationExpiresAt()

    const { data: invitation, error: insertErr } = await supabase
      .from("accounting_firm_staff_invitations")
      .insert({
        firm_id: partnerCheck.firmId,
        email_normalized: emailNormalized,
        role: roleRaw,
        token_hash: tokenHash,
        status: "pending",
        invited_by_user_id: user.id,
        expires_at: expiresAt.toISOString(),
      })
      .select("id, firm_id, email_normalized, role, status, expires_at, created_at, accepted_at, revoked_at")
      .single()

    if (insertErr) throw insertErr

    const [{ data: firm }, { data: inviter }] = await Promise.all([
      supabase.from("accounting_firms").select("name").eq("id", partnerCheck.firmId).maybeSingle(),
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
      to: emailNormalized,
      partnerName,
      firmName,
      role: roleRaw,
      acceptUrl,
      expiresAt,
    })

    await logFirmActivity({
      supabase,
      firmId: partnerCheck.firmId,
      actorUserId: user.id,
      actionType: "firm_staff_invited",
      entityType: "firm_staff_invitation",
      entityId: invitation.id,
      metadata: { role: roleRaw, invitee_email: emailNormalized, invitation_id: invitation.id },
    })

    const responseBody: Record<string, unknown> = {
      invitation: toSafeStaffInvitation(invitation),
      email_sent: emailResult.success,
    }
    if (!emailResult.success) {
      responseBody.email_error =
        "Invitation created, but email could not be sent. Try resend."
    }

    return NextResponse.json(responseBody, { status: 201 })
  } catch (e) {
    console.error("POST /api/accounting/firm/staff/invitations:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
