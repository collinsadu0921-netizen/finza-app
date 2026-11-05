import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { ACTIVE_BUSINESS_COOKIE } from "@/lib/business/activeBusiness"

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const clear = body?.clear === true
    const businessId = typeof body?.business_id === "string" ? body.business_id.trim() : ""

    if (clear) {
      const response = NextResponse.json({ ok: true, business_id: null })
      response.cookies.set(ACTIVE_BUSINESS_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 })
      return response
    }

    if (!businessId) {
      return NextResponse.json({ error: "business_id is required" }, { status: 400 })
    }

    const { data: business } = await supabase
      .from("businesses")
      .select("id, owner_id")
      .eq("id", businessId)
      .is("archived_at", null)
      .maybeSingle()

    if (!business) {
      const response = NextResponse.json(
        { error: "Workspace not found or no longer available", code: "WORKSPACE_NOT_FOUND" },
        { status: 404 }
      )
      response.cookies.set(ACTIVE_BUSINESS_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 })
      return response
    }

    let authorized = business.owner_id === user.id
    if (!authorized) {
      const { data: membership } = await supabase
        .from("business_users")
        .select("id")
        .eq("business_id", businessId)
        .eq("user_id", user.id)
        .maybeSingle()
      authorized = Boolean(membership)
    }

    if (!authorized) {
      const response = NextResponse.json(
        { error: "You do not have access to this workspace", code: "WORKSPACE_FORBIDDEN" },
        { status: 403 }
      )
      response.cookies.set(ACTIVE_BUSINESS_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 })
      return response
    }

    const response = NextResponse.json({ ok: true, business_id: businessId })
    response.cookies.set(ACTIVE_BUSINESS_COOKIE, businessId, COOKIE_OPTIONS)
    return response
  } catch (error: unknown) {
    console.error("[business/select]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
