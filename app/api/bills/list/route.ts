import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { billSupplierBalanceRemaining } from "@/lib/billBalance"

const BILL_ID_IN_CHUNK = 150

/**
 * Loads non-deleted bill_payments summed by bill_id in chunks (avoids oversized `.in(...)` URLs).
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
  const routeStartedAt = Date.now()
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      searchParams.get("business_id") ?? searchParams.get("businessId")
    )
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const business = { id: scope.businessId }
    const supplierName = searchParams.get("supplier_name")
    const status = searchParams.get("status")
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const search = searchParams.get("search")

    const limitRaw = searchParams.get("limit")
    const offsetRaw = searchParams.get("offset")
    let limitParsed: number | null = null
    let offsetParsed = 0
    if (limitRaw !== null && limitRaw.trim() !== "") {
      limitParsed = Math.min(Math.max(1, parseInt(limitRaw, 10) || 0), 5000)
    }
    if (offsetRaw !== null && offsetRaw.trim() !== "") {
      offsetParsed = Math.max(0, parseInt(offsetRaw, 10) || 0)
    }

    let query = supabase
      .from("bills")
      .select("*")
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

    if (limitParsed !== null) {
      query = query.range(offsetParsed, offsetParsed + limitParsed - 1)
    }

    const { data: bills, error } = await query

    if (error) {
      console.error("Error fetching bills:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    const billRows = bills ?? []
    const billIds = billRows.map((b) => b.id).filter((id): id is string => Boolean(id))

    let paidByBill: Map<string, number>
    try {
      paidByBill = await totalPaidByBillId(supabase, billIds)
    } catch (payErr) {
      console.error("Error fetching bill payments for list:", payErr)
      return NextResponse.json(
        {
          error: payErr instanceof Error ? payErr.message : "Failed to load bill payments",
        },
        { status: 500 }
      )
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

    if (process.env.NODE_ENV !== "production") {
      const elapsed = Date.now() - routeStartedAt
      console.debug(
        `[bills/list] ${elapsed}ms · bills=${billsWithBalances.length} · bill_ids=${billIds.length}`
      )
    }

    return NextResponse.json({ bills: billsWithBalances })
  } catch (error: unknown) {
    console.error("Error in bills list:", error)
    const msg = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
