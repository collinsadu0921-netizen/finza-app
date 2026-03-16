import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")

    // Get customer
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("*")
      .eq("id", id)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (customerError || !customer) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      )
    }

    // Build invoice query
    // INVARIANT 1: Exclude drafts - drafts never affect Customer statements
    let invoiceQuery = supabase
      .from("invoices")
      .select("*")
      .eq("customer_id", id)
      .eq("business_id", business.id)
      .neq("status", "draft")
      .is("deleted_at", null)
      .order("issue_date", { ascending: true })

    if (startDate) {
      invoiceQuery = invoiceQuery.gte("issue_date", startDate)
    }
    if (endDate) {
      invoiceQuery = invoiceQuery.lte("issue_date", endDate)
    }

    const { data: invoices, error: invoicesError } = await invoiceQuery

    if (invoicesError) {
      console.error("Error fetching invoices:", invoicesError)
    }

    // Get payments for these invoices
    const invoiceIds = (invoices || []).map((inv: any) => inv.id)
    let payments: any[] = []
    let creditNotes: any[] = []

    if (invoiceIds.length > 0) {
      const { data: paymentsData, error: paymentsError } = await supabase
        .from("payments")
        .select("*")
        .in("invoice_id", invoiceIds)
        .is("deleted_at", null)
        .order("date", { ascending: true })

      if (paymentsError) {
        console.error("Error fetching payments:", paymentsError)
      } else {
        payments = paymentsData || []
      }

      // Get credit notes
      const { data: creditNotesData, error: creditNotesError } = await supabase
        .from("credit_notes")
        .select("id, business_id, invoice_id, credit_number, date, reason, subtotal, nhil, getfund, covid, vat, total_tax, total, status, notes, public_token, created_at, updated_at, deleted_at, tax_lines, tax_engine_code, tax_engine_effective_from, tax_jurisdiction")
        .in("invoice_id", invoiceIds)
        .is("deleted_at", null)
        .order("date", { ascending: true })

      if (creditNotesError) {
        console.error("Error fetching credit notes:", creditNotesError)
      } else {
        creditNotes = creditNotesData || []
      }
    }

    // Calculate totals
    // CRITICAL: Exclude draft invoices from financial calculations
    // Draft invoices are NOT financial documents and cannot be outstanding
    const nonDraftInvoices = (invoices || []).filter((inv: any) => inv.status !== "draft")
    const totalInvoiced = nonDraftInvoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0)
    
    // Only count payments for non-draft invoices
    const nonDraftInvoiceIds = nonDraftInvoices.map((inv: any) => inv.id)
    const nonDraftPayments = payments.filter((p: any) => nonDraftInvoiceIds.includes(p.invoice_id))
    const totalPaid = nonDraftPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
    
    // Only count credit notes for non-draft invoices
    const nonDraftCreditNotes = creditNotes.filter((cn: any) => 
      cn.status === "applied" && nonDraftInvoiceIds.includes(cn.invoice_id)
    )
    const totalCredits = nonDraftCreditNotes.reduce((sum, cn) => sum + Number(cn.total || 0), 0)
    
    const totalOutstanding = totalInvoiced - totalPaid - totalCredits

    // Calculate overdue
    // CRITICAL: Exclude draft invoices from overdue calculation
    const today = new Date()
    const overdueInvoices = nonDraftInvoices.filter((inv: any) => {
      if (inv.status === "paid") return false
      if (inv.status === "draft") return false // Explicit check (should already be filtered)
      if (!inv.due_date) return false
      const dueDate = new Date(inv.due_date)
      return today > dueDate
    })
    const totalOverdue = overdueInvoices.reduce((sum, inv) => {
      const invoiceTotal = Number(inv.total || 0)
      const invoicePayments = nonDraftPayments.filter((p) => p.invoice_id === inv.id)
      const invoicePaid = invoicePayments.reduce((s, p) => s + Number(p.amount || 0), 0)
      const invoiceCredits = nonDraftCreditNotes
        .filter((cn: any) => cn.invoice_id === inv.id)
        .reduce((s, cn) => s + Number(cn.total || 0), 0)
      const outstandingAmount = Math.max(0, invoiceTotal - invoicePaid - invoiceCredits)
      return sum + outstandingAmount
    }, 0)

    // Group invoices by status
    const invoicesByStatus = {
      draft: (invoices || []).filter((inv: any) => inv.status === "draft"),
      sent: (invoices || []).filter((inv: any) => inv.status === "sent"),
      partially_paid: (invoices || []).filter((inv: any) => inv.status === "partially_paid"),
      paid: (invoices || []).filter((inv: any) => inv.status === "paid"),
      overdue: overdueInvoices,
    }

    return NextResponse.json({
      customer,
      invoices: invoices || [],
      payments: payments || [],
      creditNotes: creditNotes || [],
      summary: {
        totalInvoiced,
        totalPaid,
        totalCredits,
        totalOutstanding,
        totalOverdue,
        invoicesByStatus,
      },
    })
  } catch (error: any) {
    console.error("Error generating statement:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

