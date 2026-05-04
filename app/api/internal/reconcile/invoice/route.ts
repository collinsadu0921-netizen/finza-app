/**
 * Temporary internal debug API: invoice reconciliation (C5A).
 * GET /api/internal/reconcile/invoice?businessId=...&invoiceId=...&periodId=...&context=DISPLAY
 * READ-ONLY. Returns full ReconciliationResult as JSON.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { createReconciliationEngine } from "@/lib/accounting/reconciliation/engine-impl"
import { ReconciliationContext } from "@/lib/accounting/reconciliation/types"

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
    const invoiceId = searchParams.get("invoiceId") ?? ""
    const periodId = searchParams.get("periodId") ?? undefined
    const contextParam = searchParams.get("context") ?? "DISPLAY"

    if (!businessId || !invoiceId) {
      return NextResponse.json(
        { error: "Missing required query: businessId, invoiceId" },
        { status: 400 }
      )
    }

    const scope = await resolveBusinessScopeForUser(supabase, user.id, businessId)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const { data: invoiceRow, error: invoiceLookupError } = await supabase
      .from("invoices")
      .select("id")
      .eq("id", invoiceId)
      .eq("business_id", scope.businessId)
      .is("deleted_at", null)
      .maybeSingle()

    if (invoiceLookupError || !invoiceRow) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    const context =
      contextParam === "VALIDATE"
        ? ReconciliationContext.VALIDATE
        : contextParam === "PERIOD_CLOSE"
          ? ReconciliationContext.PERIOD_CLOSE
          : ReconciliationContext.DISPLAY

    const engine = createReconciliationEngine(supabase)
    const result = await engine.reconcileInvoice(
      { businessId: scope.businessId, invoiceId, periodId },
      context
    )

    return NextResponse.json(result)
  } catch (err: unknown) {
    console.error("Internal reconcile/invoice error:", err)
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Reconciliation failed",
      },
      { status: 500 }
    )
  }
}
