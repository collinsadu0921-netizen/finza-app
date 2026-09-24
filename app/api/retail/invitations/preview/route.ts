import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { previewRetailInvitation } from "@/lib/retail/invitations/retailInvitationAdmin"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim() ?? ""
  if (!token || token.length > 200 || token === "resume") {
    return NextResponse.json({ state: "invalid" })
  }
  const admin = getSupabaseServiceRoleClient()
  if (!admin) return NextResponse.json({ state: "invalid" }, { status: 500 })

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const preview = await previewRetailInvitation(
    admin,
    token,
    user?.id && user.email ? { userId: user.id, email: user.email } : null
  )
  return NextResponse.json(preview)
}
