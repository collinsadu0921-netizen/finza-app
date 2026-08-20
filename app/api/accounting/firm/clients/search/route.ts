/**
 * GET /api/accounting/firm/clients/search?q=...&firm_id=...
 *
 * Practice Partner/Senior discovery of eligible Finza Service businesses
 * for new client engagements. Uses admin client after auth because businesses
 * RLS only exposes owned/member/already-engaged rows.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { canUserCreateEngagements } from "@/lib/accounting/firm/engagements"
import {
  PRACTICE_CLIENT_ELIGIBLE_INDUSTRIES,
  PRACTICE_CLIENT_SEARCH_LIMIT,
  PRACTICE_CLIENT_SEARCH_MIN_QUERY,
  isEligiblePracticeClientIndustry,
} from "@/lib/accounting/firm/practiceClientSearch"

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
    const firmId = (searchParams.get("firm_id") || "").trim()
    const query = (searchParams.get("q") || "").trim()

    if (!firmId) {
      return NextResponse.json({ error: "firm_id is required" }, { status: 400 })
    }

    const canCreate = await canUserCreateEngagements(supabase, user.id, firmId)
    if (!canCreate) {
      return NextResponse.json(
        { error: "Only Partners and Seniors can search clients for engagement" },
        { status: 403 }
      )
    }

    if (query.length < PRACTICE_CLIENT_SEARCH_MIN_QUERY) {
      return NextResponse.json({ businesses: [] })
    }

    const admin = createSupabaseAdminClient()

    // Exclude businesses that already have a non-terminated engagement with this firm
    const { data: existingEngagements, error: engError } = await admin
      .from("firm_client_engagements")
      .select("client_business_id")
      .eq("accounting_firm_id", firmId)
      .neq("status", "terminated")

    if (engError) {
      console.error("[practice-client-search] engagement lookup failed", engError)
      return NextResponse.json({ error: "Failed to search businesses" }, { status: 500 })
    }

    const excludeIds = new Set(
      (existingEngagements || [])
        .map((e) => e.client_business_id as string)
        .filter(Boolean)
    )

    const { data: rows, error } = await admin
      .from("businesses")
      .select("id, name, industry")
      .ilike("name", `%${query}%`)
      .in("industry", [...PRACTICE_CLIENT_ELIGIBLE_INDUSTRIES])
      .is("archived_at", null)
      .order("name", { ascending: true })
      .limit(PRACTICE_CLIENT_SEARCH_LIMIT + excludeIds.size)

    if (error) {
      console.error("[practice-client-search] business lookup failed", error)
      return NextResponse.json({ error: "Failed to search businesses" }, { status: 500 })
    }

    const businesses = (rows || [])
      .filter(
        (b) =>
          isEligiblePracticeClientIndustry(b.industry) &&
          !excludeIds.has(b.id) &&
          b.id !== firmId
      )
      .slice(0, PRACTICE_CLIENT_SEARCH_LIMIT)
      .map((b) => ({
        id: b.id,
        name: b.name,
        industry: b.industry,
      }))

    return NextResponse.json({ businesses })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error"
    console.error("[practice-client-search]", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
