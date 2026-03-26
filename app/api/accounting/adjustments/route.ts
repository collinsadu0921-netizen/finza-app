import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"

/**
 * GET /api/accounting/adjustments?business_id=...&period_start=...
 * 
 * Lists adjusting journal entries for a given business and period
 * Returns read-only view of adjustments (journal entries with reference_type = 'adjustment')
 * 
 * Access: Admin/Owner/Accountant (read or write)
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
    const businessId = searchParams.get("business_id")
    const periodStart = searchParams.get("period_start")

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

    const authResult = await checkAccountingAuthority(supabase, user.id, resolvedBusinessId, "read")
    if (!authResult.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants can view adjusting journals." },
        { status: 403 }
      )
    }

    // Build query for adjusting journal entries (reference_type = 'adjustment')
    let query = supabase
      .from("journal_entries")
      .select(`
        id,
        date,
        description,
        reference_type,
        reference_id,
        created_by,
        created_at
      `)
      .eq("business_id", resolvedBusinessId)
      .eq("reference_type", "adjustment")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })

    // Filter by period if provided
    if (periodStart) {
      // Validate period_start format
      const periodStartDate = new Date(periodStart)
      if (isNaN(periodStartDate.getTime())) {
        return NextResponse.json(
          { error: "Invalid period_start format. Must be YYYY-MM-DD" },
          { status: 400 }
        )
      }

      // Get period to determine period_end
      const { data: period, error: periodError } = await supabase
        .from("accounting_periods")
        .select("period_start, period_end")
        .eq("business_id", resolvedBusinessId)
        .eq("period_start", periodStart)
        .single()

      if (periodError || !period) {
        return NextResponse.json(
          { error: "Accounting period not found for period_start: " + periodStart },
          { status: 404 }
        )
      }

      // Filter by date range
      query = query
        .gte("date", period.period_start)
        .lte("date", period.period_end)
    }

    const { data: journalEntries, error: entriesError } = await query

    if (entriesError) {
      console.error("Error fetching adjusting journal entries:", entriesError)
      return NextResponse.json(
        { error: entriesError.message || "Failed to fetch adjusting journal entries" },
        { status: 500 }
      )
    }

    // For each journal entry, get lines and compute totals
    const adjustments = await Promise.all(
      (journalEntries || []).map(async (entry) => {
        // Get journal entry lines
        const { data: lines, error: linesError } = await supabase
          .from("journal_entry_lines")
          .select(`
            id,
            account_id,
            debit,
            credit,
            description,
            accounts!inner (
              id,
              code,
              name,
              type
            )
          `)
          .eq("journal_entry_id", entry.id)
          .order("created_at", { ascending: true })

        if (linesError) {
          console.error("Error fetching journal entry lines:", linesError)
          return {
            ...entry,
            lines: [],
            total_debit: 0,
            total_credit: 0,
          }
        }

        // Compute totals
        const totalDebit = lines?.reduce((sum, line) => sum + Number(line.debit || 0), 0) || 0
        const totalCredit = lines?.reduce((sum, line) => sum + Number(line.credit || 0), 0) || 0

        return {
          journal_entry_id: entry.id,
          entry_date: entry.date,
          description: entry.description,
          created_by: entry.created_by,
          created_at: entry.created_at,
          total_debit: totalDebit,
          total_credit: totalCredit,
          lines: (lines || []).map((line: any) => ({
            id: line.id,
            account_id: line.account_id,
            account_code: line.accounts?.code,
            account_name: line.accounts?.name,
            account_type: line.accounts?.type,
            debit: Number(line.debit || 0),
            credit: Number(line.credit || 0),
            description: line.description,
          })),
        }
      })
    )

    return NextResponse.json({
      adjustments,
      count: adjustments.length,
    })
  } catch (error: any) {
    console.error("Error in adjusting journals GET:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
