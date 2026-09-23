import { NextRequest, NextResponse } from "next/server"
import { requireInternalOps } from "@/lib/retail/invitations/requireInternalOps"
import {
  revokeRetailInvitation,
  rotateRetailInvitation,
  sendRetailInvitationEmail,
} from "@/lib/retail/invitations/retailInvitationAdmin"

export const dynamic = "force-dynamic"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const gate = await requireInternalOps()
  if (!gate.ok) return gate.response
  const { id } = await context.params
  const body = await request.json().catch(() => null)
  const action = body && typeof body === "object" ? String((body as { action?: unknown }).action ?? "") : ""

  try {
    if (action === "revoke") {
      const confirm = Boolean(body && typeof body === "object" && (body as { confirm?: unknown }).confirm === true)
      await revokeRetailInvitation(gate.admin, {
        invitationId: id,
        actorUserId: gate.user.id,
        requestId: gate.requestId,
        confirm,
      })
      return NextResponse.json({ ok: true })
    }

    if (action === "rotate") {
      const sendEmail = Boolean(
        body && typeof body === "object" && (body as { sendEmail?: unknown }).sendEmail === true
      )
      const rotated = await rotateRetailInvitation(gate.admin, {
        invitationId: id,
        actorUserId: gate.user.id,
        requestId: gate.requestId,
        appOrigin: request.nextUrl.origin,
      })
      let emailResult = null
      if (sendEmail) {
        emailResult = await sendRetailInvitationEmail(gate.admin, {
          invitationId: rotated.invitation.id,
          activationUrl: rotated.activationUrl,
          actorUserId: gate.user.id,
          requestId: gate.requestId,
        })
      }
      return NextResponse.json({
        ok: true,
        invitation: rotated.invitation,
        activationUrl: rotated.activationUrl,
        email: emailResult,
        emailNote:
          "The previous link no longer works. Provider acceptance does not prove inbox delivery.",
      })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed"
    const status = message.includes("Confirmation is required") ? 400 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
