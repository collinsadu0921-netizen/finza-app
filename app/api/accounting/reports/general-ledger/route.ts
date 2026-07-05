import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { resolveAccountingPeriodForReport } from "@/lib/accounting/resolveAccountingPeriodForReport"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"
import { fetchGeneralLedgerForAccount } from "@/lib/accounting/fetchGeneralLedgerForAccount"
import {
  MAX_GL_MULTI_ACCOUNTS,
  resolveGeneralLedgerAccountSelection,
} from "@/lib/accounting/resolveGeneralLedgerAccountSelection"

/**
 * GET /api/accounting/reports/general-ledger
 * Returns general ledger for selected account(s) and period/date range. Period resolved server-side when not provided.
 *
 * Single-account query: business_id, account_id OR account_code; period_id | period_start | as_of_date | start_date/end_date; limit, cursor_* (optional).
 * Multi-account query: business_id + one of:
 *   - account_code_from & account_code_to
 *   - account_codes (comma-separated)
 *   - preset=payroll_liabilities
 * Dates filter journal_entries.date (via get_general_ledger).
 * Multi-account responses use view=multi and omit cursor pagination.
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
    const accountCode = searchParams.get("account_code")
    const accountCodeFrom = searchParams.get("account_code_from")
    const accountCodeTo = searchParams.get("account_code_to")
    const accountCodes = searchParams.get("account_codes")
    const preset = searchParams.get("preset")
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

    const tierBlock = await enforceServiceIndustryBusinessTierForAccountingApi(
      supabase,
      user.id,
      resolvedBusinessId
    )
    if (tierBlock) return tierBlock

    const { result: selection, error: selectionError } = await resolveGeneralLedgerAccountSelection(
      supabase,
      resolvedBusinessId,
      {
        accountId,
        accountCode,
        accountCodeFrom,
        accountCodeTo,
        accountCodes,
        preset,
      }
    )

    if (selectionError) {
      const isMissing = selectionError.includes("Missing")
      const notFound =
        selectionError.includes("not found") ||
        selectionError.includes("does not belong") ||
        selectionError.includes("Multiple accounts match")
      return NextResponse.json(
        { error: selectionError },
        { status: isMissing ? 400 : notFound ? 404 : 400 }
      )
    }

    let effectiveStartDate: string
    let effectiveEndDate: string

    if (startDate && endDate && !periodId && !periodStart && !asOfDate) {
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

    const start = new Date(effectiveStartDate)
    const end = new Date(effectiveEndDate)
    const yearsDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365)
    if (yearsDiff > 10) {
      return NextResponse.json(
        { error: "Date range cannot exceed 10 years. Please select a smaller range." },
        { status: 400 }
      )
    }

    const safeLimit = Math.min(Math.max(limit || 100, 1), 500)
    const usePagination = !!(cursorEntryDate && cursorJournalEntryId && cursorLineId)

    if (selection.kind === "multi") {
      if (usePagination) {
        return NextResponse.json(
          { error: "Pagination is not supported for multi-account general ledger. Omit cursor parameters." },
          { status: 400 }
        )
      }

      const meta = {
        account_count: selection.accounts.length,
        max_accounts: MAX_GL_MULTI_ACCOUNTS,
        truncated: selection.truncated,
        empty_reason: selection.emptyReason ?? null,
        warning: selection.truncated
          ? `Results limited to the first ${MAX_GL_MULTI_ACCOUNTS} accounts in range. Narrow the range or use account_codes.`
          : null,
      }

      if (selection.accounts.length === 0) {
        return NextResponse.json({
          view: "multi",
          period: {
            start_date: effectiveStartDate,
            end_date: effectiveEndDate,
          },
          accounts: [],
          meta,
        })
      }

      const accountsPayload = []
      for (const account of selection.accounts) {
        const block = await fetchGeneralLedgerForAccount(
          supabase,
          resolvedBusinessId,
          account,
          effectiveStartDate,
          effectiveEndDate
        )
        accountsPayload.push({
          account: {
            id: account.id,
            code: account.code,
            name: account.name,
            type: account.type,
          },
          summary: block.summary,
          totals: block.totals,
          lines: block.lines.map((line) => ({
            entry_date: line.entry_date,
            account_code: line.account_code,
            account_name: line.account_name,
            journal_entry_id: line.journal_entry_id,
            journal_entry_description: line.journal_entry_description,
            reference_type: line.reference_type,
            reference_id: line.reference_id,
            line_id: line.line_id,
            line_description: line.line_description,
            debit: line.debit,
            credit: line.credit,
            running_balance: line.running_balance,
          })),
        })
      }

      return NextResponse.json({
        view: "multi",
        period: {
          start_date: effectiveStartDate,
          end_date: effectiveEndDate,
        },
        accounts: accountsPayload,
        meta,
      })
    }

    const account = selection.accounts[0]

    if (!usePagination) {
      try {
        const block = await fetchGeneralLedgerForAccount(
          supabase,
          resolvedBusinessId,
          account,
          effectiveStartDate,
          effectiveEndDate
        )
        return NextResponse.json({
          account: {
            id: account.id,
            code: account.code,
            name: account.name,
            type: account.type,
          },
          period: {
            start_date: effectiveStartDate,
            end_date: effectiveEndDate,
          },
          lines: block.lines.map((line) => ({
            entry_date: line.entry_date,
            account_code: line.account_code,
            account_name: line.account_name,
            journal_entry_id: line.journal_entry_id,
            journal_entry_description: line.journal_entry_description,
            reference_type: line.reference_type,
            reference_id: line.reference_id,
            line_id: line.line_id,
            line_description: line.line_description,
            debit: line.debit,
            credit: line.credit,
            running_balance: line.running_balance,
          })),
          summary: block.summary,
          totals: {
            total_debit: block.summary.total_debit,
            total_credit: block.summary.total_credit,
            final_balance: block.totals.final_balance,
          },
          pagination: null,
        })
      } catch (e: unknown) {
        console.error("Error fetching general ledger:", e)
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Failed to fetch general ledger" },
          { status: 500 }
        )
      }
    }

    let ledgerLines: any[] | null = null
    let rpcError: any = null
    const { data, error } = await supabase.rpc("get_general_ledger_paginated", {
      p_business_id: resolvedBusinessId,
      p_account_id: account.id,
      p_start_date: effectiveStartDate,
      p_end_date: effectiveEndDate,
      p_limit: safeLimit,
      p_cursor_entry_date: cursorEntryDate || null,
      p_cursor_journal_entry_id: cursorJournalEntryId || null,
      p_cursor_line_id: cursorLineId || null,
    })
    ledgerLines = data
    rpcError = error

    if (rpcError) {
      console.error("Error fetching general ledger:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Failed to fetch general ledger" },
        { status: 500 }
      )
    }

    const hasMore = ledgerLines && ledgerLines.length === safeLimit
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
      period: {
        start_date: effectiveStartDate,
        end_date: effectiveEndDate,
      },
      lines: (ledgerLines || []).map((line) => ({
        entry_date: line.entry_date,
        account_code: account.code,
        account_name: account.name,
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
      summary: null,
      totals: null,
      pagination: {
        limit: safeLimit,
        has_more: hasMore || false,
        next_cursor: nextCursor,
      },
    })
  } catch (error: any) {
    console.error("Error in general ledger:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
