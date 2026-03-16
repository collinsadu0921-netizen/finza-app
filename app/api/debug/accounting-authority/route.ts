import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getAccountingAuthority } from "@/lib/accountingAuthorityEngine"

/**
 * GET /api/debug/accounting-authority?business_id=<uuid>
 *
 * Debug endpoint: returns whether the current (firm) user can access the given business
 * via the canonical authority engine. No cookies/tokens in logs.
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
    const businessId = searchParams.get("business_id")?.trim() ?? null

    if (!businessId) {
      return NextResponse.json(
        { error: "Missing query parameter: business_id" },
        { status: 400 }
      )
    }

    const result = await getAccountingAuthority({
      supabase,
      firmUserId: user.id,
      businessId,
      requiredLevel: "read",
    })

    console.log("[AUTH_DEBUG]", JSON.stringify({
      userId: user.id,
      businessId,
      allowed: result.allowed,
      reason: result.reason,
      level: result.level,
      firmId: result.firmId,
      engagementId: result.engagementId,
    }))

    return NextResponse.json({
      userId: user.id,
      businessId,
      result: {
        allowed: result.allowed,
        reason: result.reason,
        level: result.level,
        firmId: result.firmId,
        engagementId: result.engagementId,
        status: result.engagementStatus,
        effectiveFrom: result.effectiveFrom,
        effectiveTo: result.effectiveTo,
        debug: result.debug,
      },
    })
  } catch (e) {
    console.error("Accounting authority debug error:", e)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
