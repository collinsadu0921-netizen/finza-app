import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"

/**
 * GET /api/accounting/periods/has-active-engagement?business_id=
 * Returns whether the business has any active firm engagement (for hybrid period close UI).
 * Requires read accounting authority. RLS on firm_client_engagements applies.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const business_id = searchParams.get("business_id")

    if (!business_id) {
      return NextResponse.json(
        { error: "Missing required query param: business_id" },
        { status: 400 }
      )
    }

    const auth = await checkAccountingAuthority(supabase, user.id, business_id, "read")
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Accounting access required." },
        { status: 403 }
      )
    }

    const { data, error } = await supabase.rpc("business_has_active_engagement", {
      p_business_id: business_id,
    })

    if (error) {
      console.error("Error checking active engagement:", error)
      return NextResponse.json(
        { error: error.message || "Failed to check engagement" },
        { status: 500 }
      )
    }

    const has_active_engagement = Boolean(data === true || data === "true")
    return NextResponse.json({ has_active_engagement })
  } catch (err: unknown) {
    console.error("Error in has-active-engagement:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
