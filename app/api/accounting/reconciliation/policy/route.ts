/**
 * GET /api/accounting/reconciliation/policy?businessId=...
 * Returns ledger adjustment policy for the business (for UI governance display).
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { getLedgerAdjustmentPolicy } from "@/lib/accounting/reconciliation/governance"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("businessId") ?? ""

    if (!businessId) {
      return NextResponse.json(
        { error: "Missing required query param: businessId" },
        { status: 400 }
      )
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
    }

    const authResult = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!authResult.authorized) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    const policy = await getLedgerAdjustmentPolicy(supabase, businessId)
    return NextResponse.json({ policy })
  } catch (err: unknown) {
    console.error("Reconciliation policy error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load policy" },
      { status: 500 }
    )
  }
}
