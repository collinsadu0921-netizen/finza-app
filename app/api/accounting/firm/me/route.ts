import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/requireFirmMember"

/**
 * GET /api/accounting/firm/me
 * Returns whether the current user is a firm accountant (in accounting_firm_users).
 */
export async function GET() {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const forbidden = await requireFirmMemberForApi(supabase, user.id)
    if (forbidden) return forbidden

    const { data: firmUser } = await supabase
      .from("accounting_firm_users")
      .select("firm_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle()

    return NextResponse.json({ isFirmUser: !!firmUser })
  } catch (e) {
    console.error("Firm me error:", e)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
