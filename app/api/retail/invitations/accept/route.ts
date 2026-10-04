import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { SIGNUP_INTENT_RETAIL_INVITATION } from "@/lib/auth/signupWorkspace"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import {
  acceptRetailInvitation,
  acceptRetailInvitationById,
} from "@/lib/retail/invitations/retailInvitationAdmin"
import { isPlausibleRetailInviteToken } from "@/lib/retail/invitations/retailInvitationToken"
import { retailInvitationPublicError } from "@/lib/retail/invitations/retailInvitationAcceptError"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id || !user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const token = body && typeof body === "object" ? String((body as { token?: unknown }).token ?? "").trim() : ""
  const invitationId =
    body && typeof body === "object" ? String((body as { invitationId?: unknown }).invitationId ?? "").trim() : ""
  const idOk = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invitationId)
  const tokenOk = isPlausibleRetailInviteToken(token)
  if (!idOk && !tokenOk) {
    return NextResponse.json({ error: "This invitation link is not valid." }, { status: 400 })
  }

  const admin = getSupabaseServiceRoleClient()
  if (!admin) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }

  try {
    const businessId = idOk
      ? await acceptRetailInvitationById(admin, {
          invitationId,
          userId: user.id,
          email: user.email,
          requestId: crypto.randomUUID(),
        })
      : await acceptRetailInvitation(admin, {
          token,
          userId: user.id,
          email: user.email,
          requestId: crypto.randomUUID(),
        })
    try {
      const adminAuth = createSupabaseAdminClient()
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>
      if (meta.signup_intent === "business_owner" || meta.trial_intent === true) {
        await adminAuth.auth.admin.updateUserById(user.id, {
          user_metadata: {
            ...meta,
            signup_intent: SIGNUP_INTENT_RETAIL_INVITATION,
            trial_intent: false,
            trial_workspace: null,
            trial_plan: null,
          },
        })
      }
    } catch {
      // Acceptance already succeeded. Stale intent must not block the new Retail workspace.
    }
    return NextResponse.json({ ok: true, businessId })
  } catch (error) {
    const message = error instanceof Error ? error.message : "retail_invitation_invalid"
    const mapped = retailInvitationPublicError(message)
    return NextResponse.json({ error: mapped.error }, { status: mapped.status })
  }
}
