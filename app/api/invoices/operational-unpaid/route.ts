/**
 * GET /api/invoices/operational-unpaid?business_id=...
 *
 * Same operational unpaid total as the Service dashboard Unpaid invoices card.
 * Not page-scoped and not affected by Invoices list filters.
 */
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { resolveAuthenticatedApiUser } from "@/lib/server/resolveAuthenticatedApiUser"
import { loadOperationalUnpaidInvoicesSummary } from "@/lib/server/operationalUnpaidInvoicesLoader"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const auth = await resolveAuthenticatedApiUser(supabase, {
      cookieHeader: request.headers.get("cookie"),
    })
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error, auth_failure_stage: auth.authFailureStage },
        { status: auth.status }
      )
    }

    const { searchParams } = new URL(request.url)
    const scope = await resolveBusinessScopeForUser(
      supabase,
      auth.user.id,
      searchParams.get("business_id") ?? searchParams.get("businessId")
    )
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const summary = await loadOperationalUnpaidInvoicesSummary(supabase, scope.businessId)
    return NextResponse.json(summary)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
