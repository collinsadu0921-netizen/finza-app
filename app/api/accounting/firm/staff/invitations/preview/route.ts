import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import {
  hashInvitationToken,
  practiceStaffRoleLabel,
  type PracticeStaffRole,
} from "@/lib/accounting/firm/staffInvitations"

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token")?.trim()
    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()
    const tokenHash = hashInvitationToken(token)
    const { data: row, error } = await admin
      .from("accounting_firm_staff_invitations")
      .select("email_normalized, role, status, expires_at, accounting_firms(name)")
      .eq("token_hash", tokenHash)
      .maybeSingle()

    if (error) throw error
    if (!row) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 })
    }

    const now = Date.now()
    const expiresAt = new Date(row.expires_at).getTime()
    if (row.status === "revoked") {
      return NextResponse.json({ error: "This invitation has been revoked." }, { status: 410 })
    }
    if (row.status === "accepted") {
      return NextResponse.json({ error: "This invitation has already been accepted." }, { status: 410 })
    }
    if (row.status === "expired" || expiresAt <= now) {
      return NextResponse.json({ error: "This invitation has expired." }, { status: 410 })
    }
    if (row.status !== "pending") {
      return NextResponse.json({ error: "Invitation is not available." }, { status: 410 })
    }

    const firm = Array.isArray(row.accounting_firms)
      ? row.accounting_firms[0]
      : row.accounting_firms

    return NextResponse.json({
      firm_name: firm?.name ?? "Practice firm",
      role: row.role,
      role_label: practiceStaffRoleLabel(row.role as PracticeStaffRole),
      email: row.email_normalized,
      expires_at: row.expires_at,
    })
  } catch (e) {
    console.error("GET /api/accounting/firm/staff/invitations/preview:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
