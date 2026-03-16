/**
 * GET /api/accounting/periods/audit-readiness?businessId=&periodId=
 *
 * Read-only endpoint that calls run_period_close_checks RPC.
 * Returns normalized response with ok, failures, checked_at.
 *
 * No writes. No logging. No side effects.
 * Used by Periods page to show readiness before close attempt.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"

export interface AuditReadinessFailure {
  code: string
  title: string
  detail: string
  scope?: {
    type: "invoice" | "customer" | "period"
    id?: string
  }
}

export interface AuditReadinessResponse {
  ok: boolean
  failures: AuditReadinessFailure[]
  checked_at: string
}

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
    const businessId = searchParams.get("businessId")
    const periodId = searchParams.get("periodId")

    if (!businessId || !periodId) {
      return NextResponse.json(
        { error: "Missing required query params: businessId, periodId" },
        { status: 400 }
      )
    }

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Accountant or admin access required." },
        { status: 403 }
      )
    }

    // Call run_period_close_checks RPC
    const { data: checks, error: checksError } = await supabase.rpc(
      "run_period_close_checks",
      {
        p_business_id: businessId,
        p_period_id: periodId,
      }
    )

    if (checksError) {
      console.error("Error running period close checks:", checksError)
      return NextResponse.json(
        { error: checksError.message || "Failed to run period close checks" },
        { status: 500 }
      )
    }

    const checksResult = checks as { ok: boolean; failures: Array<{ code: string; title: string; detail: string }> }

    // Normalize failures with scope information where applicable
    const failures: AuditReadinessFailure[] = (checksResult.failures ?? []).map((f) => {
      const failure: AuditReadinessFailure = {
        code: f.code,
        title: f.title,
        detail: f.detail,
      }

      // Add scope for AR-related failures
      if (f.code === "UNRESOLVED_AR_MISMATCHES" || f.code === "AR_RECONCILIATION_MISMATCH") {
        failure.scope = { type: "period", id: periodId }
      }

      return failure
    })

    const response: AuditReadinessResponse = {
      ok: checksResult.ok === true,
      failures,
      checked_at: new Date().toISOString(),
    }

    return NextResponse.json(response)
  } catch (error: unknown) {
    console.error("Error in audit readiness check:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
