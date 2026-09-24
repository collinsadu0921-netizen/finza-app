import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { pendingRetailInvitationForEmail } from "@/lib/retail/invitations/retailInvitationAdmin"

export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const admin = getSupabaseServiceRoleClient()
  if (!admin) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }
  const pending = await pendingRetailInvitationForEmail(admin, user.email)
  if (!pending) {
    return NextResponse.json({ state: "none" })
  }
  return NextResponse.json({
    state: "ready",
    invitationId: pending.id,
    businessName: pending.businessName,
  })
}
