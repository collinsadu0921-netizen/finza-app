import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { resolveAccountingPeriodForReport } from "@/lib/accounting/resolveAccountingPeriodForReport"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"

/**
 * GET /api/accounting/reports/general-ledger
 * Returns general ledger for selected account and period/date range. Period resolved server-side when not provided.
 * Query: business_id, account_id (required); period_id | period_start | as_of_date | start_date/end_date (optional); limit, cursor_* (optional).
 */
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
    const accountId = searchParams.get("account_id")
    const periodId = searchParams.get("period_id")
    const periodStart = searchParams.get("period_start")
    const asOfDate = searchParams.get("as_of_date")
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const limit = parseInt(searchParams.get("limit") || "100")
    const cursorEntryDate = searchParams.get("cursor_entry_date")
    const cursorJournalEntryId = searchParams.get("cursor_journal_entry_id")
    const cursorLineId = searchParams.get("cursor_line_id")

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
    if ("error" in resolved) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }
    const resolvedBusinessId = resolved.businessId

    if (!accountId) {
      return NextResponse.json(
        { error: "Missing required parameter: account_id" },
        { status: 400 }
      )
    }

    const auth = await checkAccountingAuthority(
      supabase,
      user.id,
      resolvedBusinessId,
      "read"
    )
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants can view general ledger." },
        { status: 403 }
      )
    }

    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id, code, name, type")
      .eq("id", accountId)
      .eq("business_id", resolvedBusinessId)
      .is("deleted_at", null)
      .single()

    if (accountError || !account) {
      return NextResponse.json(
        { error: "Account not found or does not belong to business" },
        { status: 404 }
      )
    }

    let effectiveStartDate: string
    let effectiveEndDate: string

    if (startDate && endDate && !periodId && !periodStart && !asOfDate) {
      // Explicit date range (no period context)
      effectiveStartDate = startDate
      effectiveEndDate = endDate
    } else {
      const { period: resolvedPeriod, error: resolveError } = await resolveAccountingPeriodForReport(
        supabase,
        { businessId: resolvedBusinessId, period_id: periodId, period_start: periodStart, as_of_date: asOfDate, start_date: startDate, end_date: endDate }
      )
      if (resolveError || !resolvedPeriod) {
        return NextResponse.json(
          { error: resolveError ?? "Accounting period could not be resolved" },
          { status: 500 }
        )
      }
      effectiveStartDate = resolvedPeriod.period_start
      effectiveEndDate = resolvedPeriod.period_end
    }

    // Validate date range (reject absurd ranges > 10 years)
    const start = new Date(effectiveStartDate)
    const end = new Date(effectiveEndDate)
    const yearsDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365)
    if (yearsDiff > 10) {
      return NextResponse.json(
        { error: "Date range cannot exceed 10 years. Please select a smaller range." },
        { status: 400 }
      )
    }

    // Enforce max limit (500)
    const safeLimit = Math.min(Math.max(limit || 100, 1), 500)

    // Use paginated function if cursor is provided, otherwise use regular function
    const usePagination = !!(cursorEntryDate && cursorJournalEntryId && cursorLineId)

    let ledgerLines: any[] | null = null
    let rpcError: any = null

    if (usePagination) {
      // Use paginated function
      const { data, error } = await supabase.rpc("get_general_ledger_paginated", {
        p_business_id: resolvedBusinessId,
        p_account_id: accountId,
        p_start_date: effectiveStartDate,
        p_end_date: effectiveEndDate,
        p_limit: safeLimit,
        p_cursor_entry_date: cursorEntryDate || null,
        p_cursor_journal_entry_id: cursorJournalEntryId || null,
        p_cursor_line_id: cursorLineId || null,
      })
      ledgerLines = data
      rpcError = error
    } else {
      // Use regular function (no pagination)
      const { data, error } = await supabase.rpc("get_general_ledger", {
        p_business_id: resolvedBusinessId,
        p_account_id: accountId,
        p_start_date: effectiveStartDate,
        p_end_date: effectiveEndDate,
      })
      ledgerLines = data
      rpcError = error
    }

    if (rpcError) {
      console.error("Error fetching general ledger:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Failed to fetch general ledger" },
        { status: 500 }
      )
    }

    // Calculate totals (only for non-paginated)
    const totalDebit = !usePagination ? (ledgerLines?.reduce((sum, line) => sum + Number(line.debit || 0), 0) || 0) : null
    const totalCredit = !usePagination ? (ledgerLines?.reduce((sum, line) => sum + Number(line.credit || 0), 0) || 0) : null
    const finalBalance = ledgerLines && ledgerLines.length > 0 
      ? Number(ledgerLines[ledgerLines.length - 1].running_balance || 0)
      : 0

    // Determine if there are more rows (for pagination)
    const hasMore = usePagination && ledgerLines && ledgerLines.length === safeLimit
    const nextCursor = hasMore && ledgerLines && ledgerLines.length > 0 
      ? {
          entry_date: ledgerLines[ledgerLines.length - 1].entry_date,
          journal_entry_id: ledgerLines[ledgerLines.length - 1].journal_entry_id,
          line_id: ledgerLines[ledgerLines.length - 1].line_id,
        }
      : null

    return NextResponse.json({
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
      },
      period: periodStart ? {
        period_start: periodStart,
        start_date: effectiveStartDate,
        end_date: effectiveEndDate,
      } : {
        start_date: effectiveStartDate,
        end_date: effectiveEndDate,
      },
      lines: (ledgerLines || []).map((line) => ({
        entry_date: line.entry_date,
        journal_entry_id: line.journal_entry_id,
        journal_entry_description: line.journal_entry_description,
        reference_type: line.reference_type,
        reference_id: line.reference_id,
        line_id: line.line_id,
        line_description: line.line_description,
        debit: Number(line.debit || 0),
        credit: Number(line.credit || 0),
        running_balance: Number(line.running_balance || 0),
      })),
      totals: totalDebit !== null && totalCredit !== null ? {
        total_debit: Math.round(totalDebit * 100) / 100,
        total_credit: Math.round(totalCredit * 100) / 100,
        final_balance: Math.round(finalBalance * 100) / 100,
      } : null,
      pagination: usePagination ? {
        limit: safeLimit,
        has_more: hasMore || false,
        next_cursor: nextCursor,
      } : null,
    })
  } catch (error: any) {
    console.error("Error in general ledger:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
