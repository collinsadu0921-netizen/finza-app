import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"

/**
 * POST /api/retail/register/open-session
 * Opens a cashier session server-side (retail). Enforces role + register ownership;
 * duplicate open session per register is blocked by DB unique index (migration 425).
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

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    // Must match getUserRole(): owners are businesses.owner_id even if business_users.role is employee/staff/etc.
    const role = await getUserRole(supabase, user.id, business.id)
    if (!role || !["owner", "admin", "manager"].includes(role)) {
      return NextResponse.json(
        { error: "Only owners, admins, or managers can open a register session." },
        { status: 403 },
      )
    }

    const body = await request.json().catch(() => ({}))
    const register_id = body.register_id as string | undefined
    const opening_float = Number(body.opening_float)

    if (!register_id) {
      return NextResponse.json({ error: "register_id is required" }, { status: 400 })
    }
    if (!Number.isFinite(opening_float) || opening_float < 0) {
      return NextResponse.json(
        { error: "opening_float must be a number greater than or equal to 0" },
        { status: 400 },
      )
    }

    const { data: register, error: regErr } = await supabase
      .from("registers")
      .select("id, business_id, store_id, name")
      .eq("id", register_id)
      .maybeSingle()

    if (regErr || !register) {
      return NextResponse.json({ error: "Register not found" }, { status: 404 })
    }

    if (register.business_id !== business.id) {
      return NextResponse.json({ error: "Register does not belong to this business" }, { status: 403 })
    }

    const storeId = register.store_id as string | null
    if (!storeId) {
      return NextResponse.json(
        { error: "Register is not assigned to a store. Assign it in Register settings first." },
        { status: 400 },
      )
    }

    if (role === "manager") {
      const { data: urow } = await supabase.from("users").select("store_id").eq("id", user.id).maybeSingle()
      const assigned = urow?.store_id as string | null
      if (!assigned || assigned !== storeId) {
        return NextResponse.json(
          { error: "You can only open registers for your assigned store." },
          { status: 403 },
        )
      }
    }

    const sessionRow = {
      register_id,
      user_id: user.id,
      business_id: business.id,
      opening_float,
      opening_cash: opening_float,
      status: "open" as const,
      started_at: new Date().toISOString(),
      store_id: storeId,
    }

    const { data: inserted, error: insErr } = await supabase
      .from("cashier_sessions")
      .insert(sessionRow)
      .select("id, register_id, store_id, status, started_at")
      .single()

    if (insErr) {
      const code = (insErr as { code?: string }).code
      if (code === "23505") {
        return NextResponse.json(
          {
            error: "This register already has an open session. Close it first or use a different register.",
            code: "REGISTER_ALREADY_OPEN",
          },
          { status: 409 },
        )
      }
      console.error("open-session insert:", insErr)
      return NextResponse.json(
        { error: insErr.message || "Failed to open register session" },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      session: inserted,
      register: { id: register.id, name: register.name as string, store_id: storeId },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
