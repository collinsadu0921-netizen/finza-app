import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { ensureAccountingInitialized, canUserInitializeAccounting } from "@/lib/accountingBootstrap"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"
import {
  getAccountingDataClient,
  resolveAccountingRequestAuthority,
} from "@/lib/accounting/resolveAccountingRequestAuthority"
import {
  createRouteDiag,
  jsonResponseWithServerTiming,
  timedStepMs,
} from "@/lib/server/routeDiagnostics"

export async function GET(request: NextRequest) {
  const routeT0 = performance.now()
  const diag = createRouteDiag("ledger_list")
  const respond = <T>(body: T, status: number) =>
    jsonResponseWithServerTiming(body, {
      status,
      serverTiming: diag.serverTimingHeader([{ name: "total", dur: timedStepMs(routeT0) }]),
    })

  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    diag.recordTiming("auth", timedStepMs(tAuth), "session")
    if (!user) {
      return respond({ error: "Unauthorized" }, 401)
    }

    const { searchParams } = new URL(request.url)
    const businessId = (searchParams.get("business_id") ?? searchParams.get("businessId"))?.trim() ?? null

    if (!businessId) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id", error_code: "MISSING_BUSINESS_ID" },
        { status: 400 }
      )
    }

    const authResult = await resolveAccountingRequestAuthority({
      supabase,
      userId: user.id,
      businessId,
      requiredLevel: "read",
    })
    if (authResult.timings) {
      diag.recordTiming("role", authResult.timings.role_ms)
      diag.recordTiming("authority", authResult.timings.authority_ms)
    }
    if (!authResult.ok) {
      return respond(
        { error: authResult.error, reason_code: authResult.reasonCode },
        authResult.status
      )
    }

    const tierBlockLedgerList = await enforceServiceIndustryBusinessTierForAccountingApi(
      supabase,
      user.id,
      businessId
    )
    if (tierBlockLedgerList) return tierBlockLedgerList

    const dataClient = getAccountingDataClient(authResult, supabase)

    if (canUserInitializeAccounting(authResult.isPractice ? "accountant" : authResult.authoritySource)) {
      const bootstrap = await ensureAccountingInitialized(supabase, businessId)
      if (bootstrap.error) {
        const structured = bootstrap.structuredError
        const body = {
          error: "ACCOUNTING_NOT_READY",
          business_id: businessId,
          authority_source: authResult.authoritySource,
          ...(structured && {
            error_code: structured.error_code,
            message: structured.message,
          }),
        }
        return NextResponse.json(
          body,
          { status: structured?.error_code === "INIT_DENIED" ? 403 : 500 }
        )
      }
    }

    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const accountId = searchParams.get("account_id")
    const accountCode = searchParams.get("account_code")
    const referenceType = searchParams.get("reference_type")
    const referenceId = searchParams.get("reference_id")
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("page_size") || "25", 10) || 25))

    let query = dataClient
      .from("journal_entries")
      .select(
        `
        *,
        journal_entry_lines (
          id,
          account_id,
          debit,
          credit,
          description,
          accounts (
            id,
            name,
            code,
            type
          )
        )
      `,
        { count: "exact" }
      )
      .eq("business_id", businessId)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })

    if (startDate) {
      query = query.gte("date", startDate)
    }

    if (endDate) {
      query = query.lte("date", endDate)
    }

    if (referenceType) {
      query = query.eq("reference_type", referenceType)
    }

    if (referenceId) {
      query = query.eq("reference_id", referenceId)
    }

    if (accountId || accountCode) {
      let idQuery = dataClient
        .from("journal_entries")
        .select("id, journal_entry_lines!inner(account_id, accounts!inner(code))")
        .eq("business_id", businessId)

      if (startDate) idQuery = idQuery.gte("date", startDate)
      if (endDate) idQuery = idQuery.lte("date", endDate)
      if (referenceType) idQuery = idQuery.eq("reference_type", referenceType)
      if (referenceId) idQuery = idQuery.eq("reference_id", referenceId)
      if (accountId) idQuery = idQuery.eq("journal_entry_lines.account_id", accountId)
      if (accountCode) idQuery = idQuery.ilike("journal_entry_lines.accounts.code", `%${accountCode}%`)

      const { data: matchingEntries, error: idError } = await idQuery
      if (idError) {
        console.error("Error resolving ledger account filters:", { businessId, idError })
        return NextResponse.json(
          { error: idError.message, step: "ledger_account_filter_query", business_id: businessId },
          { status: 500 }
        )
      }

      const matchingIds = [...new Set((matchingEntries || []).map((entry: any) => entry.id).filter(Boolean))]
      if (matchingIds.length === 0) {
        return NextResponse.json({
          entries: [],
          pagination: { page, pageSize, total: 0, totalPages: 0 },
        })
      }
      query = query.in("id", matchingIds)
    }

    // Apply pagination
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1
    query = query.range(from, to)

    const tDb = performance.now()
    const { data: entries, error, count } = await query

    if (error) {
      console.error("Error fetching ledger:", { businessId, error })
      return NextResponse.json(
        {
          error: error.message,
          step: "ledger_list_query",
          business_id: businessId,
          error_code: "ACCOUNTING_DATA_UNAVAILABLE",
          supabase_error: { message: error.message, code: error.code, details: error.details },
        },
        { status: 500 }
      )
    }

    // Currency is required for Money UI; Practice users cannot read /api/business/profile
    // (owner/business_users only). Load via the same scoped data client.
    const { data: businessRow, error: currencyError } = await dataClient
      .from("businesses")
      .select("default_currency")
      .eq("id", businessId)
      .maybeSingle()

    if (currencyError) {
      console.error("Error fetching ledger currency:", { businessId, currencyError })
      return NextResponse.json(
        {
          error: currencyError.message,
          step: "ledger_currency_query",
          business_id: businessId,
          error_code: "ACCOUNTING_DATA_UNAVAILABLE",
        },
        { status: 500 }
      )
    }

    diag.recordTiming("db", timedStepMs(tDb), "ledger")
    return respond({
      entries: entries || [],
      default_currency: businessRow?.default_currency ?? null,
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    }, 200)
  } catch (error: unknown) {
    console.error("Error in ledger list:", error)
    return respond(
      { error: error instanceof Error ? error.message : "Internal server error" },
      500
    )
  }
}


