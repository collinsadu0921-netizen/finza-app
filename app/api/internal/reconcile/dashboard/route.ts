/**
 * Internal API: check if any recent invoices have reconciliation discrepancies.
 * GET /api/internal/reconcile/dashboard?businessId=...
 * READ-ONLY. Returns { hasDiscrepancy: boolean }. Does not change data or KPIs.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { createReconciliationEngine } from "@/lib/accounting/reconciliation/engine-impl"
import { ReconciliationContext, ReconciliationStatus } from "@/lib/accounting/reconciliation/types"

const MAX_INVOICES_TO_CHECK = 10

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
    const businessId = searchParams.get("businessId") ?? ""

    if (!businessId) {
      return NextResponse.json(
        { error: "Missing required query: businessId" },
        { status: 400 }
      )
    }

    const scope = await resolveBusinessScopeForUser(supabase, user.id, businessId)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const { data: invoices } = await supabase
      .from("invoices")
      .select("id")
      .eq("business_id", scope.businessId)
      .neq("status", "draft")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_INVOICES_TO_CHECK)

    let hasDiscrepancy = false
    if (invoices && invoices.length > 0) {
      const engine = createReconciliationEngine(supabase)
      for (const inv of invoices) {
        const result = await engine.reconcileInvoice(
          { businessId: scope.businessId, invoiceId: inv.id },
          ReconciliationContext.DISPLAY
        )
        if (result.status === ReconciliationStatus.WARN || result.status === ReconciliationStatus.FAIL) {
          hasDiscrepancy = true
          break
        }
      }
    }

    return NextResponse.json({ hasDiscrepancy })
  } catch (err: unknown) {
    console.error("Internal reconcile/dashboard error:", err)
    return NextResponse.json(
      { hasDiscrepancy: false, error: err instanceof Error ? err.message : "Check failed" },
      { status: 500 }
    )
  }
}
