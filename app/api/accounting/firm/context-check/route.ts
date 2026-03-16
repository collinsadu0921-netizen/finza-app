import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/requireFirmMember"
import { getAccountingAuthority } from "@/lib/accountingAuthorityEngine"
import { CLIENT_REQUIRED } from "@/lib/accounting/reasonCodes"

/**
 * GET /api/accounting/firm/context-check?business_id=...
 *
 * Pure validator (Wave 5). URL business_id only. No redirectTo, no autoSelect, no effective list.
 * Returns 200 with hasClient + businessId + reason.
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

    const forbidden = await requireFirmMemberForApi(supabase, user.id)
    if (forbidden) return forbidden

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")?.trim() ?? null

    if (!businessId) {
      return NextResponse.json({
        hasClient: false,
        businessId: null,
        reason: CLIENT_REQUIRED,
      })
    }

    const auth = await getAccountingAuthority({
      supabase,
      firmUserId: user.id,
      businessId,
      requiredLevel: "read",
    })

    if (auth.allowed) {
      return NextResponse.json({
        hasClient: true,
        businessId,
      })
    }

    return NextResponse.json({
      hasClient: false,
      businessId,
      reason: auth.reason || "AUTH_DENIED",
    })
  } catch (e) {
    console.error("Context check error:", e)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
