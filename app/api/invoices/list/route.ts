import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"

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
    const requestedBusinessId =
      (searchParams.get("business_id") ?? searchParams.get("businessId"))?.trim() || null

    let business: { id: string } | null = null
    if (requestedBusinessId) {
      const role = await getUserRole(supabase, user.id, requestedBusinessId)
      if (!role) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      const { data: b } = await supabase
        .from("businesses")
        .select("id")
        .eq("id", requestedBusinessId)
        .is("archived_at", null)
        .maybeSingle()
      if (!b) {
        return NextResponse.json({ error: "Business not found" }, { status: 404 })
      }
      business = b
    } else {
      const resolved = await getCurrentBusiness(supabase, user.id)
      business = resolved ? { id: resolved.id } : null
    }

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }
    const status = searchParams.get("status")
    const customerId = searchParams.get("customer_id")
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const search = searchParams.get("search")

    let query = supabase
      .from("invoices")
      .select(
        `
        *,
        customers (
          id,
          name,
          email,
          phone,
          whatsapp_phone
        )
      `
      )
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("issue_date", { ascending: false })

    // Handle status filter
    // Special case: "overdue" filter requires calculation based on FINANCIAL STATE (payments/credit notes) and due_date
    // ACCOUNTING RULES:
    // - Outstanding amount = invoice.total - sum(payments) - sum(credit_notes)
    // - Overdue = outstanding_amount > 0 AND due_date < today
    // - Paid invoices (outstanding_amount = 0) must NEVER appear, regardless of status
    // - Financial state (outstanding_amount) must override document status
    if (status === "overdue") {
      // For overdue, we need to filter invoices that have outstanding balance > 0 AND due_date < today
      // Do NOT filter by status - use financial state calculation instead
      // First, get all invoices with due_date (we'll filter by outstanding amount in memory)
      const today = new Date().toISOString().split("T")[0]
      query = query
        .not("due_date", "is", null)
        .lt("due_date", today)
    } else if (status) {
      query = query.eq("status", status)
    }

    if (customerId) {
      query = query.eq("customer_id", customerId)
    }

    if (startDate) {
      query = query.gte("issue_date", startDate)
    }

    if (endDate) {
      query = query.lte("issue_date", endDate)
    }

    if (search) {
      // First, search for customers that match the search term
      const { data: matchingCustomers } = await supabase
        .from("customers")
        .select("id")
        .ilike("name", `%${search}%`)
        .is("deleted_at", null)

      const matchingCustomerIds = matchingCustomers?.map((c: any) => c.id) || []

      // Build search conditions: invoice_number, notes, or customer_id in matching customers
      const searchConditions = [
        `invoice_number.ilike.%${search}%`,
        `notes.ilike.%${search}%`,
      ]

      // If we found matching customers, add customer_id condition
      if (matchingCustomerIds.length > 0) {
        searchConditions.push(`customer_id.in.(${matchingCustomerIds.join(",")})`)
      }

      query = query.or(searchConditions.join(","))
    }

    let { data: invoices, error } = await query

    if (error) {
      console.error("Error fetching invoices:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // If filtering for overdue, calculate outstanding amounts from payments and credit notes
    if (status === "overdue" && invoices && invoices.length > 0) {
      const invoiceIds = invoices.map((inv: any) => inv.id)
      
      // Get all payments for these invoices
      const { data: payments } = await supabase
        .from("payments")
        .select("invoice_id, amount")
        .in("invoice_id", invoiceIds)
        .is("deleted_at", null)

      // Get all applied credit notes for these invoices
      const { data: creditNotes } = await supabase
        .from("credit_notes")
        .select("invoice_id, total")
        .in("invoice_id", invoiceIds)
        .eq("status", "applied")
        .is("deleted_at", null)

      // Calculate outstanding amount for each invoice
      const invoicePaymentsMap: Record<string, number> = {}
      payments?.forEach((payment: any) => {
        if (payment.invoice_id) {
          invoicePaymentsMap[payment.invoice_id] = 
            (invoicePaymentsMap[payment.invoice_id] || 0) + Number(payment.amount || 0)
        }
      })

      const invoiceCreditNotesMap: Record<string, number> = {}
      creditNotes?.forEach((cn: any) => {
        if (cn.invoice_id) {
          invoiceCreditNotesMap[cn.invoice_id] = 
            (invoiceCreditNotesMap[cn.invoice_id] || 0) + Number(cn.total || 0)
        }
      })

      // Filter to only invoices that are OVERDUE: outstanding_amount > 0 AND due_date < today
      // Paid invoices (outstanding_amount = 0) must NEVER appear, regardless of status
      // Financial state (outstanding_amount) must override document status
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      
      invoices = invoices.filter((inv: any) => {
        // Rule: Exclude draft invoices (not yet issued)
        if (inv.status === "draft") {
          return false
        }
        
        // Calculate outstanding amount from financial state (payments + credit notes)
        const totalPaid = invoicePaymentsMap[inv.id] || 0
        const totalCredits = invoiceCreditNotesMap[inv.id] || 0
        const outstandingAmount = Math.max(0, Number(inv.total || 0) - totalPaid - totalCredits)
        
        // Rule: If outstanding_amount = 0, invoice is PAID and must be excluded
        if (outstandingAmount <= 0) {
          return false // Exclude fully paid invoices
        }
        
        // Rule: Overdue = outstanding_amount > 0 AND due_date < today
        if (!inv.due_date) {
          return false // Exclude invoices without due date
        }
        
        const dueDate = new Date(inv.due_date)
        dueDate.setHours(0, 0, 0, 0)
        
        return today > dueDate // Only include if past due date
      })
    }

    return NextResponse.json({ invoices: invoices || [] })
  } catch (error: any) {
    console.error("Error in invoice list:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
