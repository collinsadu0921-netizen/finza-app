import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"
import {
  hashInvitationToken,
  normalizeInvitationEmail,
} from "@/lib/accounting/firm/staffInvitations"
import { PRACTICE_HOME_PATH } from "@/lib/auth/signupWorkspace"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const token = typeof body.token === "string" ? body.token.trim() : ""
    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 })
    }

    const userEmail = normalizeInvitationEmail(user.email ?? "")
    if (!userEmail) {
      return NextResponse.json({ error: "Your account has no email address." }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()
    const tokenHash = hashInvitationToken(token)

    const { data: invitation, error: lookupErr } = await admin
      .from("accounting_firm_staff_invitations")
      .select("id, firm_id, email_normalized, role, status, expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle()

    if (lookupErr) throw lookupErr
    if (!invitation) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 })
    }

    const now = new Date()
    if (invitation.status === "revoked") {
      return NextResponse.json({ error: "This invitation has been revoked." }, { status: 410 })
    }
    if (invitation.status === "accepted") {
      return NextResponse.json({ error: "This invitation has already been accepted." }, { status: 410 })
    }
    if (invitation.status === "expired" || new Date(invitation.expires_at).getTime() <= now.getTime()) {
      if (invitation.status === "pending") {
        await admin
          .from("accounting_firm_staff_invitations")
          .update({ status: "expired", updated_at: now.toISOString() })
          .eq("id", invitation.id)
      }
      return NextResponse.json({ error: "This invitation has expired." }, { status: 410 })
    }
    if (invitation.status !== "pending") {
      return NextResponse.json({ error: "Invitation is not available." }, { status: 410 })
    }

    if (userEmail !== invitation.email_normalized) {
      return NextResponse.json(
        {
          error: `This invitation was sent to ${invitation.email_normalized}. Sign in with that email to accept.`,
        },
        { status: 403 }
      )
    }

    const { data: existingMembership } = await supabase
      .from("accounting_firm_users")
      .select("id")
      .eq("firm_id", invitation.firm_id)
      .eq("user_id", user.id)
      .maybeSingle()

    if (existingMembership?.id) {
      return NextResponse.json(
        { error: "You are already a member of this firm.", redirect: PRACTICE_HOME_PATH },
        { status: 409 }
      )
    }

    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle()

    if (!existingUser) {
      const { error: userInsertErr } = await supabase.from("users").insert({
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || "",
      })
      if (userInsertErr) {
        console.error("accept invitation users insert:", userInsertErr)
        return NextResponse.json({ error: "Failed to provision user profile" }, { status: 500 })
      }
    }

    const { error: membershipErr } = await supabase.from("accounting_firm_users").insert({
      firm_id: invitation.firm_id,
      user_id: user.id,
      role: invitation.role,
    })

    if (membershipErr) {
      console.error("accept invitation membership insert:", membershipErr)
      return NextResponse.json({ error: "Failed to create firm membership" }, { status: 500 })
    }

    const acceptedAt = now.toISOString()
    const { error: updateErr } = await admin
      .from("accounting_firm_staff_invitations")
      .update({
        status: "accepted",
        accepted_at: acceptedAt,
        accepted_by_user_id: user.id,
        updated_at: acceptedAt,
      })
      .eq("id", invitation.id)
      .eq("status", "pending")

    if (updateErr) {
      console.error("accept invitation status update:", updateErr)
    }

    await logFirmActivity({
      supabase,
      firmId: invitation.firm_id,
      actorUserId: user.id,
      actionType: "firm_staff_invitation_accepted",
      entityType: "firm_staff_invitation",
      entityId: invitation.id,
      metadata: { role: invitation.role, invitation_id: invitation.id },
    })

    return NextResponse.json({
      firm_id: invitation.firm_id,
      role: invitation.role,
      redirect: PRACTICE_HOME_PATH,
    })
  } catch (e) {
    console.error("POST /api/accounting/firm/staff/invitations/accept:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
