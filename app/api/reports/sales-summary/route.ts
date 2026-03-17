import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"

export async function GET(request: NextRequest) {
  // HARD GUARD: Block execution - This report uses operational tables instead of ledger
  return NextResponse.json(
    {
      code: "LEDGER_ONLY_REPORT_REQUIRED",
      error: "This report has been deprecated. Use accounting reports.",
    },
    { status: 410 }
  )

  // BLOCKED: All code below is unreachable
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const ctx = await resolveAccountingContext({ supabase, userId: user!.id, searchParams, source: "api" })
    if ("error" in ctx) {
      return NextResponse.json(
        { error: (ctx as { error: string }).error, error_code: "CLIENT_REQUIRED" },
        { status: 400 }
      )
    }
    const business = { id: (ctx as { businessId: string }).businessId }

    const { searchParams: queryParams } = new URL(request.url)
    
    // TRACK B1: LEGACY ROUTE GUARD - This route reads from operational tables (invoices, credit_notes)
    // Require explicit opt-in via ?legacy_ok=1 to prevent accidental usage
    const legacyOk = queryParams.get("legacy_ok")
    if (legacyOk !== "1") {
      return NextResponse.json(
        {
          error: "This report is deprecated. Use accounting reports.",
          deprecated: true,
          canonical_alternative: "/api/accounting/reports/profit-and-loss",
        },
        { status: 410 }
      )
    }

    const startDate = queryParams.get("start_date")
    const endDate = queryParams.get("end_date")

    // INVARIANT 1: Exclude drafts - drafts never affect Financial Reports
    let query = supabase
      .from("invoices")
      .select("total, subtotal_before_tax, total_tax_amount, status, issue_date")
      .eq("business_id", business.id)
      .neq("status", "draft")
      .is("deleted_at", null)

    if (startDate) {
      query = query.gte("issue_date", startDate)
    }

    if (endDate) {
      query = query.lte("issue_date", endDate)
    }

    const { data: invoices, error } = await query

    if (error) {
      console.error("Error fetching invoices for sales summary:", error)
      return NextResponse.json(
        { error: error?.message ?? "Unknown error" },
        { status: 500 }
      )
    }

    // Get credit notes for these invoices
    const invoiceIds = invoices?.map((inv: any) => inv.id) || []
    let creditNotes: any[] = []
    
    if (invoiceIds.length > 0) {
      let creditQuery = supabase
        .from("credit_notes")
        .select("total, subtotal, total_tax, status, date, invoice_id")
        .in("invoice_id", invoiceIds)
        .is("deleted_at", null)
      
      if (startDate) {
        creditQuery = creditQuery.gte("date", startDate)
      }
      if (endDate) {
        creditQuery = creditQuery.lte("date", endDate)
      }
      
      const { data: creditNotesData } = await creditQuery
      creditNotes = creditNotesData || []
    }

    // Calculate summary (subtract applied credit notes)
    // CRITICAL: Exclude draft invoices from financial calculations
    // Draft invoices are NOT financial documents and cannot affect revenue
    const nonDraftInvoices = (invoices || []).filter((inv: any) => inv.status !== "draft")
    
    const appliedCredits = creditNotes.filter((cn) => cn.status === "applied")
    const totalCredits = appliedCredits.reduce((sum, cn) => sum + Number(cn.total || 0), 0)
    const totalCreditSubtotal = appliedCredits.reduce((sum, cn) => sum + Number(cn.subtotal || 0), 0)
    const totalCreditTax = appliedCredits.reduce((sum, cn) => sum + Number(cn.total_tax || 0), 0)

    const totalRevenue = (nonDraftInvoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0) || 0) - totalCredits
    const totalSubtotal = (nonDraftInvoices.reduce((sum, inv) => sum + Number(inv.subtotal_before_tax || 0), 0) || 0) - totalCreditSubtotal
    const totalTax = (nonDraftInvoices.reduce((sum, inv) => sum + Number(inv.total_tax_amount || 0), 0) || 0) - totalCreditTax
    const paidRevenue = nonDraftInvoices.filter(inv => inv.status === "paid" || inv.status === "partially_paid").reduce((sum, inv) => sum + Number(inv.total || 0), 0) || 0
    const pendingRevenue = nonDraftInvoices.filter(inv => inv.status === "sent" || inv.status === "overdue").reduce((sum, inv) => sum + Number(inv.total || 0), 0) || 0

    // Group by status
    const byStatus = {
      draft: invoices?.filter(inv => inv.status === "draft").length || 0,
      sent: invoices?.filter(inv => inv.status === "sent").length || 0,
      paid: invoices?.filter(inv => inv.status === "paid").length || 0,
      overdue: invoices?.filter(inv => inv.status === "overdue").length || 0,
    }

    return NextResponse.json({
      summary: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalSubtotal: Math.round(totalSubtotal * 100) / 100,
        totalTax: Math.round(totalTax * 100) / 100,
        paidRevenue: Math.round(paidRevenue * 100) / 100,
        pendingRevenue: Math.round(pendingRevenue * 100) / 100,
        totalCredits: Math.round(totalCredits * 100) / 100,
        totalInvoices: invoices?.length || 0,
        byStatus,
      },
      invoices: invoices || [],
      creditNotes: creditNotes || [],
    })
  } catch (error: any) {
    console.error("Error in sales summary:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

