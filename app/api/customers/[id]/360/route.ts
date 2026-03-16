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

    // Get all invoices
    // INVARIANT 1: Exclude drafts - drafts never affect Customer statements
    const { data: invoices } = await supabase
      .from("invoices")
      .select("id, invoice_number, issue_date, due_date, total, status")
      .eq("customer_id", id)
      .eq("business_id", business.id)
      .neq("status", "draft")
      .is("deleted_at", null)
      .order("issue_date", { ascending: false })

    // Get all payments
    const invoiceIds = (invoices || []).map((inv: any) => inv.id)
    let payments: any[] = []
    if (invoiceIds.length > 0) {
      const { data: paymentsData } = await supabase
        .from("payments")
        .select("id, invoice_id, amount, date, method")
        .in("invoice_id", invoiceIds)
        .is("deleted_at", null)
        .order("date", { ascending: false })
      payments = paymentsData || []
    }

    // Get all estimates
    const { data: estimates } = await supabase
      .from("estimates")
      .select("id, estimate_number, issue_date, expiry_date, total, status")
      .eq("customer_id", id)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("issue_date", { ascending: false })

    // Get all orders
    const { data: orders } = await supabase
      .from("orders")
      .select("id, order_number, issue_date, expected_completion_date, total_amount, status")
      .eq("customer_id", id)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("issue_date", { ascending: false })

    // Get all credit notes
    let creditNotes: any[] = []
    if (invoiceIds.length > 0) {
      const { data: creditNotesData } = await supabase
        .from("credit_notes")
        .select("id, invoice_id, credit_number, date, total, status")
        .in("invoice_id", invoiceIds)
        .is("deleted_at", null)
        .order("date", { ascending: false })
      creditNotes = creditNotesData || []
    }

    // Get customer notes
    const { data: notes } = await supabase
      .from("customer_notes")
      .select("id, note, created_at, created_by")
      .eq("customer_id", id)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    // INVARIANT: Customer 360 is 100% operational and invoice-based
    // Total Invoiced = sum(invoice.total) for customer (drafts already excluded in query)
    const totalInvoiced = (invoices || []).reduce((sum, inv) => sum + Number(inv.total || 0), 0)
    
    // Total Paid = sum(payments.amount) linked to customer invoices
    const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
    
    // Total Credits = sum(credit_notes.total) for applied credit notes
    const appliedCreditNotes = creditNotes.filter((cn: any) => cn.status === "applied")
    const totalCredits = appliedCreditNotes.reduce((sum, cn) => sum + Number(cn.total || 0), 0)
    
    // Outstanding = sum(max(0, invoice.total − payments − credit_notes))
    const totalOutstanding = (invoices || []).reduce((sum, inv) => {
      const invoicePayments = payments.filter((p: any) => p.invoice_id === inv.id)
      const invoiceCredits = creditNotes.filter((cn: any) => 
        cn.invoice_id === inv.id && cn.status === "applied"
      )
      const paid = invoicePayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
      const credits = invoiceCredits.reduce((sum, cn) => sum + Number(cn.total || 0), 0)
      const outstanding = Math.max(0, Number(inv.total || 0) - paid - credits)
      return sum + outstanding
    }, 0)

    // Overdue = outstanding for invoices past due_date
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayISO = today.toISOString().split("T")[0]
    
    const overdueAmount = (invoices || []).reduce((sum, inv) => {
      // Only consider invoices past due_date
      if (!inv.due_date || inv.due_date >= todayISO) return sum
      
      const invoicePayments = payments.filter((p: any) => p.invoice_id === inv.id)
      const invoiceCredits = creditNotes.filter((cn: any) => 
        cn.invoice_id === inv.id && cn.status === "applied"
      )
      const paid = invoicePayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
      const credits = invoiceCredits.reduce((sum, cn) => sum + Number(cn.total || 0), 0)
      const outstanding = Math.max(0, Number(inv.total || 0) - paid - credits)
      return sum + outstanding
    }, 0)

    // Build activity timeline (chronological)
    const activities: any[] = []
    
    invoices?.forEach((inv: any) => {
      activities.push({
        type: "invoice",
        id: inv.id,
        number: inv.invoice_number,
        date: inv.issue_date,
        amount: inv.total,
        status: inv.status,
        entity: inv,
      })
    })
    
    estimates?.forEach((est: any) => {
      activities.push({
        type: "estimate",
        id: est.id,
        number: est.estimate_number,
        date: est.issue_date,
        amount: est.total,
        status: est.status,
        entity: est,
      })
    })
    
    orders?.forEach((ord: any) => {
      activities.push({
        type: "order",
        id: ord.id,
        number: ord.order_number,
        date: ord.issue_date,
        amount: ord.total_amount,
        status: ord.status,
        entity: ord,
      })
    })
    
    payments.forEach((p: any) => {
      activities.push({
        type: "payment",
        id: p.id,
        number: null,
        date: p.date,
        amount: p.amount,
        status: null,
        entity: p,
      })
    })
    
    creditNotes.forEach((cn: any) => {
      activities.push({
        type: "credit_note",
        id: cn.id,
        number: cn.credit_number,
        date: cn.date,
        amount: cn.total,
        status: cn.status,
        entity: cn,
      })
    })

    // Sort by date (newest first)
    activities.sort((a, b) => {
      const dateA = new Date(a.date).getTime()
      const dateB = new Date(b.date).getTime()
      return dateB - dateA
    })

    return NextResponse.json({
      customer,
      summary: {
        totalInvoiced,
        totalPaid,
        totalCredits,
        totalOutstanding,
        overdueAmount,
        invoiceCount: (invoices || []).length,
        estimateCount: estimates?.length || 0,
        orderCount: orders?.length || 0,
        paymentCount: payments.length,
        creditNoteCount: creditNotes.length,
      },
      activities,
      notes: notes || [],
    })
  } catch (error: any) {
    console.error("Error loading customer 360:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
