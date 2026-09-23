import { NextRequest, NextResponse } from "next/server"
import { requireInternalOps } from "@/lib/retail/invitations/requireInternalOps"
import {
  createRetailInvitation,
  listRetailInvitations,
  materializeExpiredRetailInvitations,
  sendRetailInvitationEmail,
  type RetailInvitationStatus,
} from "@/lib/retail/invitations/retailInvitationAdmin"

export const dynamic = "force-dynamic"

const STATUSES = ["all", "pending", "accepted", "revoked", "expired"] as const

export async function GET(request: NextRequest) {
  const gate = await requireInternalOps()
  if (!gate.ok) return gate.response

  const statusRaw = request.nextUrl.searchParams.get("status") ?? "pending"
  const status = (STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as RetailInvitationStatus | "all")
    : "pending"
  const page = Math.max(parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10) || 1, 1)
  const pageSize = Math.min(
    50,
    Math.max(parseInt(request.nextUrl.searchParams.get("page_size") ?? "20", 10) || 20, 1)
  )

  try {
    await materializeExpiredRetailInvitations(gate.admin, gate.user.id, gate.requestId)
    const result = await listRetailInvitations(gate.admin, { status, page, pageSize })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list invitations"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireInternalOps()
  if (!gate.ok) return gate.response

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const record = body as Record<string, unknown>
  const email = String(record.email ?? "")
  const businessName = String(record.businessName ?? record.business_name ?? "")
  const note = record.note == null ? null : String(record.note)
  const sendEmail = record.sendEmail === true || record.send_email === true

  try {
    const created = await createRetailInvitation(gate.admin, {
      email,
      businessName,
      note,
      actorUserId: gate.user.id,
      requestId: gate.requestId,
      appOrigin: request.nextUrl.origin,
    })
    let emailResult = null
    if (sendEmail) {
      emailResult = await sendRetailInvitationEmail(gate.admin, {
        invitationId: created.invitation.id,
        activationUrl: created.activationUrl,
        actorUserId: gate.user.id,
        requestId: gate.requestId,
      })
    }
    return NextResponse.json({
      ok: true,
      invitation: created.invitation,
      activationUrl: created.activationUrl,
      email: emailResult,
      emailNote:
        "Provider acceptance means the email was accepted for sending. It does not prove inbox delivery.",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create invitation"
    const status = message.includes("pending invitation already exists") ? 409 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
