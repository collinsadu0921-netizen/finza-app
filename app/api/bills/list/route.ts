import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { billSupplierBalanceRemaining } from "@/lib/billBalance"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { createRouteDiag, supabaseErrorDiag, timedStepMs } from "@/lib/server/routeDiagnostics"

const BILL_ID_IN_CHUNK = 150
const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

/**
 * Loads non-deleted bill_payments summed by bill_id in chunks (avoids oversized `.in(...)` URLs).
 * Scoped to the current page of bill IDs only.
 */
async function totalPaidByBillId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  billIds: string[]
): Promise<Map<string, number>> {
  const totals = new Map<string, number>()
  if (billIds.length === 0) return totals

  for (let i = 0; i < billIds.length; i += BILL_ID_IN_CHUNK) {
    const slice = billIds.slice(i, i + BILL_ID_IN_CHUNK)
    const { data: rows, error } = await supabase
      .from("bill_payments")
      .select("bill_id, amount")
      .in("bill_id", slice)
      .is("deleted_at", null)

    if (error) throw error

    for (const row of rows ?? []) {
      const bid = row.bill_id != null ? String(row.bill_id) : ""
      if (!bid) continue
      const amt = Number(row.amount) || 0
      totals.set(bid, (totals.get(bid) ?? 0) + amt)
    }
  }

  return totals
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const routeName =
    searchParams.has("page") || searchParams.has("limit")
      ? "bills_list_paginated"
      : "bills_list_default_bounded"
  let diag = createRouteDiag(routeName)

  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      diag.fail(401, "Unauthorized")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      searchParams.get("business_id") ?? searchParams.get("businessId")
    )
    diag.step("auth", { ms_auth: timedStepMs(tAuth) })

    if (!scope.ok) {
      diag.fail(scope.status, scope.error)
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const tTier = performance.now()
    const tierDenied = await enforceServiceIndustryMinTier(
      supabase,
      user.id,
      scope.businessId,
      "professional"
    )
    diag.step("entitlement", { ms_entitlement: timedStepMs(tTier) })
    if (tierDenied) {
      diag.fail(tierDenied.status, "tier_denied")
      return tierDenied
    }

    diag = createRouteDiag(routeName, scope.businessId)

    const business = { id: scope.businessId }
    const supplierName = searchParams.get("supplier_name")
    const status = searchParams.get("status")
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const search = searchParams.get("search")

    const page = Math.max(
      DEFAULT_PAGE,
      Number.parseInt(searchParams.get("page") || String(DEFAULT_PAGE), 10) || DEFAULT_PAGE
    )
    const limitRaw = Number.parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT
    const limit = Math.min(MAX_LIMIT, Math.max(1, limitRaw))
    const from = (page - 1) * limit
    const to = from + limit - 1

    let query = supabase
      .from("bills")
      .select("*", { count: "exact" })
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("issue_date", { ascending: false })

    if (supplierName) {
      query = query.ilike("supplier_name", `%${supplierName}%`)
    }

    if (status) {
      query = query.eq("status", status)
    }

    if (startDate) {
      query = query.gte("issue_date", startDate)
    }

    if (endDate) {
      query = query.lte("issue_date", endDate)
    }

    if (search) {
      query = query.or(`bill_number.ilike.%${search}%,supplier_name.ilike.%${search}%`)
    }

    query = query.range(from, to)

    const tBills = performance.now()
    const { data: bills, error, count } = await query
    diag.step("bills_query", {
      ms_query: timedStepMs(tBills),
      row_count: (bills ?? []).length,
      total_count: count ?? 0,
      page,
      limit,
    })

    if (error) {
      console.error("Error fetching bills:", error)
      diag.fail(500, error.message, supabaseErrorDiag(error))
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    const billRows = bills ?? []
    const billIds = billRows.map((b) => b.id).filter((id): id is string => Boolean(id))

    let paidByBill: Map<string, number>
    try {
      const tPayments = performance.now()
      paidByBill = await totalPaidByBillId(supabase, billIds)
      diag.step("bill_payments_query", {
        ms_query: timedStepMs(tPayments),
        bill_ids: billIds.length,
      })
    } catch (payErr) {
      console.error("Error fetching bill payments for list:", payErr)
      const message = payErr instanceof Error ? payErr.message : "Failed to load bill payments"
      diag.fail(500, message)
      return NextResponse.json({ error: message }, { status: 500 })
    }

    const billsWithBalances = billRows.map((bill) => {
      const totalPaid = paidByBill.get(String(bill.id)) ?? 0
      const balance = billSupplierBalanceRemaining(
        Number(bill.total),
        bill.wht_applicable,
        bill.wht_amount,
        totalPaid
      )

      return {
        ...bill,
        total_paid: totalPaid,
        balance,
      }
    })

    const total = count ?? 0
    const hasMore = from + billsWithBalances.length < total

    diag.finish(200, { row_count: billsWithBalances.length, total })
    return NextResponse.json({
      bills: billsWithBalances,
      pagination: {
        page,
        limit,
        total,
        hasMore,
      },
    })
  } catch (error: unknown) {
    console.error("Error in bills list:", error)
    const msg = error instanceof Error ? error.message : "Internal server error"
    diag.fail(500, msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
