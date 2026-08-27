import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import {
  loadMaterialsWorkspacePayload,
  parseMaterialsWorkspaceFilters,
} from "@/lib/service/materialsWorkspaceLoad"

/**
 * GET /api/service/materials/workspace
 * Inventory rows plus last movement metadata per material (materials list page).
 * Data path is the 578 composite RPC. Auth remains the production session + Professional tier check.
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

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const denied = await enforceServiceIndustryMinTier(supabase, user.id, business.id, "professional")
    if (denied) return denied

    const filters = parseMaterialsWorkspaceFilters(new URL(request.url).searchParams)
    const payload = await loadMaterialsWorkspacePayload(supabase, String(business.id), filters)
    return NextResponse.json(payload)
  } catch (err: unknown) {
    console.error("GET /api/service/materials/workspace:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
