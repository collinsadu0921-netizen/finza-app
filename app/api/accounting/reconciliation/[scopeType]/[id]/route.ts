/**
 * GET /api/accounting/reconciliation/[scopeType]/[id]
 *
 * READ-ONLY. scopeType: invoice | customer | period. Query: businessId (required).
 * Requires auth + business membership (owner, admin, accountant). No cross-tenant access.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireBusinessRole } from "@/lib/auth/requireBusinessRole"
import { createReconciliationEngine } from "@/lib/accounting/reconciliation/engine-impl"
import { ReconciliationContext } from "@/lib/accounting/reconciliation/types"
import { produceLedgerCorrectionProposal } from "@/lib/accounting/reconciliation/resolution"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"

type RouteParams = { scopeType: string; id: string }

export async function GET(
  request: NextRequest,
  context: { params: Promise<RouteParams> }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const businessId = request.nextUrl.searchParams.get("businessId") ?? ""

    if (!businessId) {
      return NextResponse.json(
        { error: "Missing required query param: businessId" },
        { status: 400 }
      )
    }

    const auth = await requireBusinessRole(supabase, businessId, {
      allowedRoles: ["owner", "admin", "accountant"],
    })
    if (auth instanceof NextResponse) return auth

    const tierBlockScope = await enforceServiceIndustryBusinessTierForAccountingApi(
      supabase,
      auth.userId,
      auth.businessId
    )
    if (tierBlockScope) return tierBlockScope

    const params = await context.params
    const scopeType = (params.scopeType ?? "").toLowerCase()
    const id = params.id ?? ""

    if (!id) {
      return NextResponse.json(
        { error: "Missing scope id" },
        { status: 400 }
      )
    }

    if (scopeType === "customer" || scopeType === "period") {
      return NextResponse.json(
        {
          error: "Reconciliation by customer or period is not implemented yet. Use scopeType=invoice.",
        },
        { status: 501 }
      )
    }

    if (scopeType !== "invoice") {
      return NextResponse.json(
        { error: "scopeType must be invoice, customer, or period" },
        { status: 400 }
      )
    }

    const engine = createReconciliationEngine(supabase)
    const periodId = request.nextUrl.searchParams.get("periodId") ?? undefined
    const scope = { businessId, invoiceId: id, periodId }
    const result = await engine.reconcileInvoice(scope, ReconciliationContext.DISPLAY)
    const proposal = produceLedgerCorrectionProposal(result)

    return NextResponse.json({ result, proposal })
  } catch (err: unknown) {
    console.error("Reconciliation [scopeType]/[id] error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load reconciliation detail" },
      { status: 500 }
    )
  }
}
