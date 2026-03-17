/**
 * GET /api/service/expenses/activity
 *
 * Read-only. Returns ledger-derived expense activity for Service workspace.
 * Aggregates all expenses (expense, bill, adjustment_journal, reconciliation) from journal_entry_lines
 * where account.type = 'expense' and debit > 0.
 * Query: businessId (required), startDate, endDate, vendorId (optional filter), limit (default 100), cursor.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

async function ensureServiceBusinessAccess(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  businessId: string
): Promise<boolean> {
  const { data: owner } = await supabase
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .eq("owner_id", userId)
    .maybeSingle()
  if (owner) return true
  const { data: bu } = await supabase
    .from("business_users")
    .select("business_id")
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .maybeSingle()
  return !!bu
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
    const businessId = searchParams.get("businessId") ?? searchParams.get("business_id") ?? null
    if (!businessId?.trim()) {
      return NextResponse.json(
        { error: "Missing required parameter: businessId" },
        { status: 400 }
      )
    }

    const allowed = await ensureServiceBusinessAccess(supabase, user.id, businessId.trim())
    if (!allowed) {
      return NextResponse.json(
        { error: "You do not have access to this business" },
        { status: 403 }
      )
    }

    const startDate = searchParams.get("startDate") ?? searchParams.get("start_date") ?? null
    const endDate = searchParams.get("endDate") ?? searchParams.get("end_date") ?? null
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "100", 10), 1), 500)
    const cursor = searchParams.get("cursor") ?? null

    // 1) Expense account ids for this business
    const { data: expenseAccounts, error: accError } = await supabase
      .from("accounts")
      .select("id")
      .eq("business_id", businessId)
      .eq("type", "expense")

    if (accError || !expenseAccounts?.length) {
      const { data: rangeTotal } = await supabase.rpc("get_ledger_expense_total", {
        p_business_id: businessId,
        p_start_date: startDate || null,
        p_end_date: endDate || null,
      })
      return NextResponse.json({
        rows: [],
        totalAmount: 0,
        totalExpensesInRange: Number(rangeTotal ?? 0),
        nextCursor: null,
      })
    }

    const accountIds = expenseAccounts.map((a) => a.id)

    // 2) Journal entries for business (for date/ref filters and join)
    let jeQuery = supabase
      .from("journal_entries")
      .select("id, date, reference_type, reference_id, description, created_at")
      .eq("business_id", businessId)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })

    if (startDate) jeQuery = jeQuery.gte("date", startDate)
    if (endDate) jeQuery = jeQuery.lte("date", endDate)
    if (cursor) {
      const [datePart, idPart] = cursor.split("_")
      if (datePart && idPart) {
        jeQuery = jeQuery.or(`date.lt.${datePart},and(date.eq.${datePart},id.lt.${idPart})`)
      }
    }

    const { data: journalEntries, error: jeError } = await jeQuery.limit(limit + 1)

    if (jeError || !journalEntries?.length) {
      return NextResponse.json({
        rows: [],
        totalAmount: 0,
        nextCursor: null,
      })
    }

    const jeIds = journalEntries.map((je) => je.id)
    const jeMap = new Map(journalEntries.map((je) => [je.id, je]))

    // 3) Journal entry lines for these JEs where account is expense and debit > 0
    const { data: lines, error: lineError } = await supabase
      .from("journal_entry_lines")
      .select("id, journal_entry_id, account_id, debit, credit, description")
      .in("journal_entry_id", jeIds)
      .gt("debit", 0)

    if (lineError) {
      console.error("service/expenses/activity lines error:", lineError)
      return NextResponse.json(
        { error: "Failed to load expense lines" },
        { status: 500 }
      )
    }

    const accountIdSet = new Set(accountIds)
    const expenseLines = (lines || []).filter((l) => accountIdSet.has(l.account_id))
    const accountIdsUsed = [...new Set(expenseLines.map((l) => l.account_id))]

    const { data: accounts } = await supabase
      .from("accounts")
      .select("id, code, name, type")
      .in("id", accountIdsUsed)

    const accountMap = new Map((accounts || []).map((a) => [a.id, a]))

    const refExpenseIds: string[] = []
    const refBillIds: string[] = []
    for (const je of journalEntries) {
      if (je.reference_type === "expense" && je.reference_id) refExpenseIds.push(je.reference_id)
      if (je.reference_type === "bill" && je.reference_id) refBillIds.push(je.reference_id)
    }

    let expenseVendors: Record<string, string> = {}
    let billVendors: Record<string, string> = {}

    if (refExpenseIds.length) {
      const { data: expenses } = await supabase
        .from("expenses")
        .select("id, supplier_name")
        .in("id", refExpenseIds)
      expenseVendors = Object.fromEntries((expenses || []).map((e) => [e.id, e.supplier_name ?? ""]))
    }
    if (refBillIds.length) {
      const { data: bills } = await supabase
        .from("bills")
        .select("id, supplier_name")
        .in("id", refBillIds)
      billVendors = Object.fromEntries((bills || []).map((b) => [b.id, b.supplier_name ?? ""]))
    }

    const rows: {
      journal_entry_id: string
      date: string
      reference_type: string | null
      reference_id: string | null
      vendor_name: string
      account_name: string
      account_code: string
      amount: number
      description: string | null
      created_at: string
    }[] = []

    let totalAmount = 0

    for (const line of expenseLines) {
      const je = jeMap.get(line.journal_entry_id)
      if (!je) continue

      const account = accountMap.get(line.account_id)
      const amount = Number(line.debit) || 0
      totalAmount += amount

      let vendor_name = ""
      if (je.reference_type === "expense" && je.reference_id)
        vendor_name = expenseVendors[je.reference_id] ?? ""
      if (je.reference_type === "bill" && je.reference_id)
        vendor_name = billVendors[je.reference_id] ?? ""

      rows.push({
        journal_entry_id: je.id,
        date: je.date,
        reference_type: je.reference_type,
        reference_id: je.reference_id,
        vendor_name,
        account_name: account?.name ?? "",
        account_code: account?.code ?? "",
        amount,
        description: je.description ?? line.description ?? null,
        created_at: je.created_at,
      })
    }

    rows.sort((a, b) => {
      const d = b.date.localeCompare(a.date)
      if (d !== 0) return d
      return (b.created_at || "").localeCompare(a.created_at || "")
    })

    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows
    const lastRow = pageRows[pageRows.length - 1]
    const nextCursor =
      hasMore && lastRow
        ? `${lastRow.date}_${lastRow.journal_entry_id}`
        : null

    // Total for selected date range (ledger-derived) for totals panel
    const { data: rangeTotal } = await supabase.rpc("get_ledger_expense_total", {
      p_business_id: businessId,
      p_start_date: startDate || null,
      p_end_date: endDate || null,
    })
    const totalExpensesInRange = Number(rangeTotal ?? 0)

    const pageTotal = pageRows.reduce((s, r) => s + r.amount, 0)

    return NextResponse.json({
      rows: pageRows,
      totalAmount: Math.round(pageTotal * 100) / 100,
      totalExpensesInRange: Math.round(totalExpensesInRange * 100) / 100,
      nextCursor,
    })
  } catch (err) {
    console.error("service/expenses/activity error:", err)
    return NextResponse.json(
      { error: (err as Error).message || "Internal server error" },
      { status: 500 }
    )
  }
}
