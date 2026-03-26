import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/accounting/firm/requireMember"
import { getEffectiveBusinessIdsForFirmUser } from "@/lib/accounting/authorityEngine"

/**
 * GET /api/accounting/firm/engagements/effective
 *
 * Returns minimal list of client businesses the firm user has effective engagements with
 * (canonical engine: status accepted/active, within effective_from/effective_to).
 * Used for client context gate and auto-select when exactly one.
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

    const businessIds = await getEffectiveBusinessIdsForFirmUser(supabase, user.id)
    if (!businessIds.length) {
      return NextResponse.json({ clients: [] })
    }

    const { data: businesses } = await supabase
      .from("businesses")
      .select("id, name")
      .in("id", businessIds)

    const clients = (businesses || []).map((b) => ({
      id: b.id,
      name: b.name ?? "Unknown",
    }))

    return NextResponse.json({ clients })
  } catch (e) {
    console.error("Effective engagements error:", e)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
