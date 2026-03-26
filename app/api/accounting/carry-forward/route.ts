import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"

/**
 * GET /api/accounting/carry-forward?business_id=...&from_period_start=...&to_period_start=...
 * 
 * Returns existing carry-forward batch (if any) or preview of ending balances for carry-forward
 * Includes batch metadata, lines, and linked journal_entry_id
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
    const fromPeriodStart = searchParams.get("from_period_start")
    const toPeriodStart = searchParams.get("to_period_start")

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

    if (!resolvedBusinessId) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }

    if (!fromPeriodStart) {
      return NextResponse.json(
        { error: "Missing required parameter: from_period_start" },
        { status: 400 }
      )
    }

    if (!toPeriodStart) {
      return NextResponse.json(
        { error: "Missing required parameter: to_period_start" },
        { status: 400 }
      )
    }

    const authResult = await checkAccountingAuthority(supabase, user.id, resolvedBusinessId, "read")
    if (!authResult.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants can access carry-forward." },
        { status: 403 }
      )
    }

    // Validate period_start format (YYYY-MM-01)
    const fromPeriodStartDate = new Date(fromPeriodStart)
    if (isNaN(fromPeriodStartDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid from_period_start format. Must be YYYY-MM-DD" },
        { status: 400 }
      )
    }

    const toPeriodStartDate = new Date(toPeriodStart)
    if (isNaN(toPeriodStartDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid to_period_start format. Must be YYYY-MM-DD" },
        { status: 400 }
      )
    }

    // Verify from_period_start is first day of month
    const expectedFromFirstDay = new Date(
      fromPeriodStartDate.getFullYear(),
      fromPeriodStartDate.getMonth(),
      1
    )
    if (fromPeriodStartDate.getTime() !== expectedFromFirstDay.getTime()) {
      return NextResponse.json(
        { error: "from_period_start must be the first day of the month (YYYY-MM-01)" },
        { status: 400 }
      )
    }

    // Verify to_period_start is first day of month
    const expectedToFirstDay = new Date(
      toPeriodStartDate.getFullYear(),
      toPeriodStartDate.getMonth(),
      1
    )
    if (toPeriodStartDate.getTime() !== expectedToFirstDay.getTime()) {
      return NextResponse.json(
        { error: "to_period_start must be the first day of the month (YYYY-MM-01)" },
        { status: 400 }
      )
    }

    // Get existing batch for carry-forward (if any)
    const { data: batch, error: batchError } = await supabase
      .from("carry_forward_batches")
      .select(`
        id,
        business_id,
        from_period_start,
        to_period_start,
        journal_entry_id,
        created_by,
        created_at,
        note
      `)
      .eq("business_id", resolvedBusinessId)
      .eq("from_period_start", fromPeriodStart)
      .eq("to_period_start", toPeriodStart)
      .single()

    if (batchError) {
      // If not found, compute preview of ending balances
      if (batchError.code === "PGRST116") {
        // Get source period to determine period_end date
        const { data: fromPeriod, error: periodError } = await supabase
          .from("accounting_periods")
          .select("period_start, period_end, status")
          .eq("business_id", resolvedBusinessId)
          .eq("period_start", fromPeriodStart)
          .single()

        if (periodError || !fromPeriod) {
          return NextResponse.json(
            { error: "Source accounting period not found for from_period_start: " + fromPeriodStart },
            { status: 404 }
          )
        }

        // Get target period
        const { data: toPeriod, error: toPeriodError } = await supabase
          .from("accounting_periods")
          .select("period_start, period_end, status")
          .eq("business_id", resolvedBusinessId)
          .eq("period_start", toPeriodStart)
          .single()

        if (toPeriodError || !toPeriod) {
          return NextResponse.json(
            { error: "Target accounting period not found for to_period_start: " + toPeriodStart },
            { status: 404 }
          )
        }

        // Compute preview of ending balances using RPC function
        const { data: balances, error: balancesError } = await supabase.rpc(
          "compute_ending_balances_for_carry_forward",
          {
            p_business_id: resolvedBusinessId,
            p_as_of_date: fromPeriod.period_end,
          }
        )

        if (balancesError) {
          console.error("Error computing ending balances:", balancesError)
          return NextResponse.json(
            { error: balancesError.message || "Failed to compute ending balances" },
            { status: 500 }
          )
        }

        // Filter out zero balances and format for preview
        const previewBalances = (balances || [])
          .filter((b: any) => Math.abs(b.ending_balance || 0) >= 0.01)
          .map((b: any) => ({
            account_id: b.account_id,
            account_code: b.account_code,
            account_name: b.account_name,
            account_type: b.account_type,
            ending_balance: Number(b.ending_balance),
          }))

        // REMOVED: eligible_equity_accounts - no longer needed (no equity offset)
        return NextResponse.json({
          batch: null,
          preview: {
            from_period: fromPeriod,
            to_period: toPeriod,
            balances: previewBalances,
          },
        })
      }

      console.error("Error fetching carry-forward batch:", batchError)
      return NextResponse.json(
        { error: batchError.message || "Failed to fetch carry-forward batch" },
        { status: 500 }
      )
    }

    // Get lines for this batch
    const { data: lines, error: linesError } = await supabase
      .from("carry_forward_lines")
      .select(`
        id,
        batch_id,
        account_id,
        amount,
        created_at
      `)
      .eq("batch_id", batch.id)
      .order("created_at", { ascending: true })

    if (linesError) {
      console.error("Error fetching carry-forward lines:", linesError)
      return NextResponse.json(
        { error: linesError.message || "Failed to fetch carry-forward lines" },
        { status: 500 }
      )
    }

    // Get account details for lines
    const linesWithAccounts = await Promise.all(
      (lines || []).map(async (line) => {
        const { data: account } = await supabase
          .from("accounts")
          .select("id, code, name, type")
          .eq("id", line.account_id)
          .single()

        return {
          ...line,
          account: account || null,
        }
      })
    )

    // Get journal entry details (optional, for reference)
    let journalEntry = null
    if (batch.journal_entry_id) {
      const { data: entry, error: entryError } = await supabase
        .from("journal_entries")
        .select("id, date, description, reference_type, created_at")
        .eq("id", batch.journal_entry_id)
        .single()

      if (!entryError && entry) {
        journalEntry = entry
      }
    }

    return NextResponse.json({
      batch: batch,
      lines: linesWithAccounts,
      journal_entry: journalEntry,
      preview: null,
    })
  } catch (error: any) {
    console.error("Error in carry-forward GET:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
