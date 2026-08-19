import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { SIGNUP_INTENT_PRACTICE } from "@/lib/auth/signupWorkspace"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"

const DEFAULT_JURISDICTION = "Ghana"

/**
 * POST /api/accounting/firm/setup
 * Create accounting firm for a new Practice partner (idempotent when membership exists).
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

    const signupIntent =
      typeof user.user_metadata?.signup_intent === "string"
        ? user.user_metadata.signup_intent
        : undefined

    if (signupIntent !== SIGNUP_INTENT_PRACTICE) {
      return NextResponse.json(
        { error: "Practice firm setup is only available for Finza Practice signups" },
        { status: 403 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const firmName = typeof body.name === "string" ? body.name.trim() : ""
    const jurisdictionRaw =
      typeof body.jurisdiction === "string" ? body.jurisdiction.trim() : DEFAULT_JURISDICTION
    const jurisdiction = jurisdictionRaw || DEFAULT_JURISDICTION

    if (!firmName) {
      return NextResponse.json({ error: "Firm name is required" }, { status: 400 })
    }

    const { data: existingMembership, error: membershipLookupErr } = await supabase
      .from("accounting_firm_users")
      .select("firm_id, accounting_firms(id, name, onboarding_status)")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle()

    if (membershipLookupErr) {
      console.error("firm setup membership lookup:", membershipLookupErr)
      return NextResponse.json({ error: "Failed to verify firm membership" }, { status: 500 })
    }

    if (existingMembership?.firm_id) {
      const firm = Array.isArray(existingMembership.accounting_firms)
        ? existingMembership.accounting_firms[0]
        : existingMembership.accounting_firms
      return NextResponse.json({
        firm_id: existingMembership.firm_id,
        firm_name: firm?.name ?? firmName,
        onboarding_status: firm?.onboarding_status ?? "completed",
        already_exists: true,
      })
    }

    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle()

    if (!existingUser) {
      const { error: userInsertErr } = await supabase.from("users").insert({
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || "",
      })
      if (userInsertErr) {
        console.error("firm setup users insert:", userInsertErr)
        return NextResponse.json({ error: "Failed to create user profile" }, { status: 500 })
      }
    }

    const { data: firm, error: firmError } = await supabase
      .from("accounting_firms")
      .insert({
        name: firmName,
        created_by: user.id,
        legal_name: firmName,
        jurisdiction,
        onboarding_status: "completed",
        onboarding_completed_at: new Date().toISOString(),
        onboarding_completed_by: user.id,
      })
      .select("id, name, onboarding_status")
      .single()

    if (firmError || !firm) {
      console.error("firm setup create firm:", firmError)
      return NextResponse.json(
        { error: firmError?.message || "Failed to create firm" },
        { status: 500 }
      )
    }

    const { error: partnerError } = await supabase.from("accounting_firm_users").insert({
      firm_id: firm.id,
      user_id: user.id,
      role: "partner",
    })

    if (partnerError) {
      console.error("firm setup partner insert:", partnerError)
      await supabase.from("accounting_firms").delete().eq("id", firm.id)
      return NextResponse.json(
        { error: partnerError.message || "Failed to add partner to firm" },
        { status: 500 }
      )
    }

    await logFirmActivity({
      supabase,
      firmId: firm.id,
      actorUserId: user.id,
      actionType: "firm_created",
      entityType: "business",
      entityId: null,
      metadata: { name: firmName, jurisdiction },
    })

    await logFirmActivity({
      supabase,
      firmId: firm.id,
      actorUserId: user.id,
      actionType: "firm_onboarding_completed",
      entityType: "business",
      entityId: null,
      metadata: { legal_name: firmName, jurisdiction },
    })

    return NextResponse.json({
      firm_id: firm.id,
      firm_name: firm.name,
      onboarding_status: firm.onboarding_status,
      already_exists: false,
    })
  } catch (error: unknown) {
    console.error("POST /api/accounting/firm/setup:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
