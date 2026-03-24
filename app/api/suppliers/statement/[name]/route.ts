import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { billSupplierBalanceRemaining } from "@/lib/billBalance"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> | { name: string } }
) {
  try {
    // Handle Next.js 16 params (can be a Promise)
    const resolvedParams = await Promise.resolve(params)
    const supplierName = decodeURIComponent(resolvedParams.name)

    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const denied = await enforceServiceWorkspaceAccess({
      supabase, userId: user.id, businessId: business.id, minTier: "professional",
    })
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")

    // Get all bills for this supplier
    // Use ILIKE for case-insensitive matching in case supplier name has different casing
    let billsQuery = supabase
      .from("bills")
      .select("*")
      .eq("business_id", business.id)
      .ilike("supplier_name", supplierName) // Case-insensitive match
      .is("deleted_at", null)
      .order("issue_date", { ascending: true })

    if (startDate) {
      billsQuery = billsQuery.gte("issue_date", startDate)
    }

    if (endDate) {
      billsQuery = billsQuery.lte("issue_date", endDate)
    }

    const { data: bills, error: billsError } = await billsQuery

    if (billsError) {
      console.error("Error fetching bills:", billsError)
      return NextResponse.json(
        { error: `Failed to fetch bills: ${billsError.message}` },
        { status: 500 }
      )
    }

    // Get all payments for these bills
    const billIds = (bills || []).map((bill: any) => bill.id)
    let payments: any[] = []

    if (billIds.length > 0) {
      const { data: paymentsData, error: paymentsError } = await supabase
        .from("bill_payments")
        .select("*")
        .in("bill_id", billIds)
        .is("deleted_at", null)
        .order("date", { ascending: true })

      if (paymentsError) {
        console.error("Error fetching payments:", paymentsError)
      } else {
        payments = paymentsData || []
      }
    }

    // Calculate totals
    // CRITICAL: Exclude draft bills from outstanding calculation (same logic as bills list page)
    const nonDraftBills = (bills || []).filter((bill: any) => bill.status !== "draft" && bill.status !== "paid")
    const totalBilled = nonDraftBills.reduce((sum, bill) => sum + Number(bill.total || 0), 0)
    
    // Calculate total paid for non-draft bills only
    const nonDraftBillIds = nonDraftBills.map((bill: any) => bill.id)
    const nonDraftPayments = payments.filter((p) => nonDraftBillIds.includes(p.bill_id))
    const totalPaid = nonDraftPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
    
    // Outstanding = sum of net supplier balance per unpaid bill (gross − WHT when applicable − payments)
    const apBills = (bills || []).filter(
      (bill: any) => bill.status !== "draft" && bill.status !== "paid"
    )
    const totalOutstanding = apBills.reduce((sum, bill: any) => {
      const billPaid = payments
        .filter((p) => p.bill_id === bill.id)
        .reduce((s, p) => s + Number(p.amount || 0), 0)
      return (
        sum +
        billSupplierBalanceRemaining(
          Number(bill.total || 0),
          bill.wht_applicable,
          bill.wht_amount,
          billPaid
        )
      )
    }, 0)

    // Calculate overdue (use same net balance as bill view / AP)
    const today = new Date()
    const overdueBills = (bills || []).filter((bill: any) => {
      if (bill.status === "paid") return false
      if (!bill.due_date) return false
      const dueDate = new Date(bill.due_date)
      return today > dueDate
    })

    const totalOverdue = overdueBills.reduce((sum, bill: any) => {
      const billPayments = payments.filter((p) => p.bill_id === bill.id)
      const billPaid = billPayments.reduce((s, p) => s + Number(p.amount || 0), 0)
      return (
        sum +
        billSupplierBalanceRemaining(
          Number(bill.total || 0),
          bill.wht_applicable,
          bill.wht_amount,
          billPaid
        )
      )
    }, 0)

    // Group bills by status
    const billsByStatus = {
      draft: (bills || []).filter((bill: any) => bill.status === "draft"),
      open: (bills || []).filter((bill: any) => bill.status === "open"),
      partially_paid: (bills || []).filter((bill: any) => bill.status === "partially_paid"),
      paid: (bills || []).filter((bill: any) => bill.status === "paid"),
      overdue: (bills || []).filter((bill: any) => bill.status === "overdue"),
    }

    // Get supplier info from first bill or use defaults
    const firstBill = bills && bills.length > 0 ? bills[0] : null
    
    return NextResponse.json({
      success: true,
      supplier: {
        name: supplierName,
        phone: firstBill?.supplier_phone || null,
        email: firstBill?.supplier_email || null,
      },
      bills: bills || [],
      payments: payments || [],
      summary: {
        totalBilled,
        totalPaid,
        totalOutstanding,
        totalOverdue,
        billsByStatus,
      },
    })
  } catch (error: any) {
    console.error("Error in supplier statement:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
