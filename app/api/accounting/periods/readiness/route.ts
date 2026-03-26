import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"

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
    const period_start = searchParams.get("period_start")

    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Forbidden"
      return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
    }

    const resolved = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams,
      pathname: new URL(request.url).pathname,
      source: "api",
    })
    const resolvedBusinessId = "error" in resolved ? null : resolved.businessId

    // Validate required fields
    if (!resolvedBusinessId || !period_start) {
      return NextResponse.json(
        { error: "Missing required fields: business_id, period_start" },
        { status: 400 }
      )
    }

    // Validate period_start format (YYYY-MM-01) — string check to avoid timezone issues
    if (!/^\d{4}-\d{2}-01$/.test(period_start)) {
      return NextResponse.json(
        { error: "period_start must be the first day of the month (YYYY-MM-01)" },
        { status: 400 }
      )
    }
    const periodStartDate = new Date(period_start)
    if (isNaN(periodStartDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid period_start format. Must be YYYY-MM-01" },
        { status: 400 }
      )
    }

    const auth = await checkAccountingAuthority(supabase, user.id, resolvedBusinessId, "read")
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Accountant access required." },
        { status: 403 }
      )
    }

    // Call readiness checks resolver
    const { data: readinessResult, error: readinessError } = await supabase.rpc(
      "check_period_close_readiness",
      {
        p_business_id: resolvedBusinessId,
        p_period_start: period_start,
      }
    )

    if (readinessError) {
      console.error("Error checking period readiness:", readinessError)
      return NextResponse.json(
        { error: readinessError.message || "Failed to check period readiness" },
        { status: 500 }
      )
    }

    const readiness = readinessResult as {
      status: string
      blockers: Array<{ code: string; title: string; detail: string; deepLink: string | null }>
      warnings: unknown[]
      period_id: string | null
    }

    // Merge pre-close audit checks (trial balance, AR reconciliation, unresolved mismatches)
    const periodId = readiness.period_id ?? (await (async () => {
      const { data: periodRow } = await supabase
        .from("accounting_periods")
        .select("id")
        .eq("business_id", resolvedBusinessId)
        .eq("period_start", period_start)
        .maybeSingle()
      return periodRow?.id ?? null
    })())

    if (periodId) {
      const { data: checks, error: checksErr } = await supabase.rpc("run_period_close_checks", {
        p_business_id: resolvedBusinessId,
        p_period_id: periodId,
      })
      if (!checksErr && checks && typeof checks === "object" && "ok" in checks && !(checks as { ok: boolean }).ok) {
        const failures = (checks as { failures?: Array<{ code: string; title: string; detail: string }> }).failures ?? []
        const auditBlockers = failures.map((f) => ({
          code: f.code,
          title: f.title,
          detail: f.detail,
          deepLink: "/accounting/reconciliation" as string | null,
        }))
        readiness.blockers = [...(readiness.blockers ?? []), ...auditBlockers]
        readiness.status = "BLOCKED"
      }
    }

    return NextResponse.json({
      success: true,
      readiness,
    })
  } catch (error: any) {
    console.error("Error in period readiness check:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
