import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createClient } from "@supabase/supabase-js"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { canActorRemoveBusinessMember } from "@/lib/staff/businessStaffPermissions"

function getSupabaseAdmin() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required")
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * Removes a row from business_users (retail/service staff list).
 * Enforces role matrix server-side.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await request.json()) as { business_user_id?: string }
    const businessUserId = typeof body.business_user_id === "string" ? body.business_user_id.trim() : ""
    if (!businessUserId) {
      return NextResponse.json({ error: "business_user_id is required" }, { status: 400 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const actorRole = await getUserRole(supabase, user.id, business.id)
    if (!actorRole || actorRole === "cashier") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const supabaseAdmin = getSupabaseAdmin()

    const { data: row, error: fetchErr } = await supabaseAdmin
      .from("business_users")
      .select("id, user_id, role, business_id")
      .eq("id", businessUserId)
      .eq("business_id", business.id)
      .maybeSingle()

    if (fetchErr || !row) {
      return NextResponse.json({ error: "Staff record not found" }, { status: 404 })
    }

    const ownerId = business.owner_id as string | null

    if (
      !canActorRemoveBusinessMember(actorRole, user.id, row.user_id, row.role, ownerId)
    ) {
      return NextResponse.json(
        { error: "Forbidden: you cannot remove this user with your current role." },
        { status: 403 }
      )
    }

    const { error: delErr } = await supabaseAdmin.from("business_users").delete().eq("id", businessUserId)

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal error"
    if (message.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
