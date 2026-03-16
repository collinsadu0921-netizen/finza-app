/**
 * GET /api/accounting/debug/context?business_id=...
 *
 * Dev-only: full context for "open accounting" debugging.
 * Auth decision from authority engine; engagement_state/reason_code from real engagement row + evaluator.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getAccountingAuthority } from "@/lib/accountingAuthorityEngine"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { evaluateEngagementState } from "@/lib/accounting/evaluateEngagementState"

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 })
  }

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

    const resolved = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams: { get: (k: string) => searchParams.get(k) },
      source: "api",
    })

    const authoritySource =
      "error" in resolved ? null : (resolved.authoritySource as "accountant" | "owner" | "employee")

    const auth = await getAccountingAuthority({
      supabase,
      firmUserId: user.id,
      businessId,
      requiredLevel: "read",
    })

    const { ready } = await checkAccountingReadiness(supabase, businessId)

    if ("error" in resolved) {
      return NextResponse.json({
        userId: user.id,
        authoritySource: null,
        business_id: businessId,
        engagement: null,
        engagement_state: null,
        readiness: { ready },
        allow: false,
        deny: true,
        reason_code: resolved.error,
      })
    }

    const isAccountant = authoritySource === "accountant"
    let engagementRow: {
      id: string
      accounting_firm_id: string
      client_business_id: string
      status: string
      access_level: string
      effective_from: string
      effective_to: string | null
      accepted_at: string | null
      accepted_by: string | null
    } | null = null
    if (isAccountant) {
      const { data: firmUsers } = await supabase
        .from("accounting_firm_users")
        .select("firm_id")
        .eq("user_id", user.id)
      const firmIds = (firmUsers ?? []).map((r) => r.firm_id)
      if (firmIds.length > 0) {
        const { data: rows } = await supabase
          .from("firm_client_engagements")
          .select("id, accounting_firm_id, client_business_id, status, access_level, effective_from, effective_to, accepted_at, accepted_by")
          .in("accounting_firm_id", firmIds)
          .eq("client_business_id", businessId)
          .limit(1)
        engagementRow = rows?.[0] ?? null
      }
    }

    const evalResult = evaluateEngagementState({
      engagement: engagementRow
        ? { status: engagementRow.status, effective_from: engagementRow.effective_from, effective_to: engagementRow.effective_to }
        : null,
      now: new Date(),
    })

    const allow = isAccountant ? auth.allowed : true
    const reason_code = allow ? null : (isAccountant ? evalResult.reason_code : null)

    return NextResponse.json({
      userId: user.id,
      authoritySource,
      business_id: businessId,
      engagement: isAccountant ? (engagementRow ? { ...engagementRow } : null) : null,
      engagement_state: evalResult.state,
      reason_code,
      readiness: { ready },
      allow,
      deny: !allow,
    })
  } catch (e) {
    console.error("Debug context error:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
