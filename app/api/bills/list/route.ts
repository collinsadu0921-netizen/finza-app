import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { billSupplierBalanceRemaining } from "@/lib/billBalance"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const supplierName = searchParams.get("supplier_name")
    const status = searchParams.get("status")
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const search = searchParams.get("search")

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

    const { data: bills, error } = await query

    if (error) {
      console.error("Error fetching bills:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // Calculate balances for each bill
    const billsWithBalances = await Promise.all(
      (bills || []).map(async (bill) => {
        const { data: payments } = await supabase
          .from("bill_payments")
          .select("amount")
          .eq("bill_id", bill.id)
          .is("deleted_at", null)

        const totalPaid = payments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0
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
    )

    return NextResponse.json({ bills: billsWithBalances || [] })
  } catch (error: any) {
    console.error("Error in bills list:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

