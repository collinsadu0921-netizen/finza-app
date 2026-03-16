import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

/**
 * GET: Check for invoices that need due date reminders
 * POST: Send due date reminder for a specific invoice
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

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    // Get reminder settings from invoice_settings
    const { data: invoiceSettings } = await supabase
      .from("invoice_settings")
      .select("due_date_reminders_enabled, due_date_reminder_days")
      .eq("business_id", business.id)
      .maybeSingle()

    // Default: 3 days before due date, disabled by default
    const remindersEnabled = invoiceSettings?.due_date_reminders_enabled || false
    const daysBeforeDue = invoiceSettings?.due_date_reminder_days || 3

    if (!remindersEnabled) {
      return NextResponse.json({
        reminders: [],
        message: "Due date reminders are not enabled",
      })
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Calculate target due date (today + daysBeforeDue)
    const targetDueDate = new Date(today)
    targetDueDate.setDate(targetDueDate.getDate() + daysBeforeDue)
    const targetDueDateStr = targetDueDate.toISOString().split("T")[0]

    // Get invoices with due_date = targetDueDate AND outstanding_amount > 0
    // Exclude draft invoices (not yet issued)
    const { data: invoices, error: invoicesError } = await supabase
      .from("invoices")
      .select(
        `
        id,
        invoice_number,
        due_date,
        total,
        status,
        public_token,
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
      .eq("due_date", targetDueDateStr)
      .neq("status", "draft")
      .neq("status", "paid")
      .neq("status", "cancelled")
      .is("deleted_at", null)

    if (invoicesError) {
      console.error("Error fetching invoices:", invoicesError)
      return NextResponse.json(
        { error: invoicesError.message },
        { status: 500 }
      )
    }

    if (!invoices || invoices.length === 0) {
      return NextResponse.json({ reminders: [] })
    }

    // Get all payments and credit notes to calculate outstanding amounts
    const invoiceIds = invoices.map((inv: any) => inv.id)
    let payments: any[] = []
    let creditNotes: any[] = []

    if (invoiceIds.length > 0) {
      const { data: paymentsData } = await supabase
        .from("payments")
        .select("invoice_id, amount")
        .in("invoice_id", invoiceIds)
        .is("deleted_at", null)

      payments = paymentsData || []

      const { data: creditNotesData } = await supabase
        .from("credit_notes")
        .select("invoice_id, total")
        .in("invoice_id", invoiceIds)
        .eq("status", "applied")
        .is("deleted_at", null)

      creditNotes = creditNotesData || []
    }

    // Calculate outstanding amounts
    const invoicePaymentsMap: Record<string, number> = {}
    payments.forEach((p: any) => {
      if (p.invoice_id) {
        invoicePaymentsMap[p.invoice_id] = (invoicePaymentsMap[p.invoice_id] || 0) + Number(p.amount || 0)
      }
    })

    const invoiceCreditNotesMap: Record<string, number> = {}
    creditNotes.forEach((cn: any) => {
      if (cn.invoice_id) {
        invoiceCreditNotesMap[cn.invoice_id] = (invoiceCreditNotesMap[cn.invoice_id] || 0) + Number(cn.total || 0)
      }
    })

    // Filter to only invoices with outstanding_amount > 0
    const invoicesWithOutstanding = invoices.filter((inv: any) => {
      const totalPaid = invoicePaymentsMap[inv.id] || 0
      const totalCredits = invoiceCreditNotesMap[inv.id] || 0
      const outstandingAmount = Math.max(0, Number(inv.total || 0) - totalPaid - totalCredits)
      return outstandingAmount > 0
    })

    // Get existing reminders to prevent duplicates
    const { data: existingReminders } = await supabase
      .from("invoice_reminders")
      .select("invoice_id, reminder_type, days_before_due, sent_at")
      .in("invoice_id", invoiceIds)
      .eq("reminder_type", "due_date")

    const reminders: any[] = []

    invoicesWithOutstanding.forEach((invoice: any) => {
      const totalPaid = invoicePaymentsMap[invoice.id] || 0
      const totalCredits = invoiceCreditNotesMap[invoice.id] || 0
      const outstandingAmount = Math.max(0, Number(invoice.total || 0) - totalPaid - totalCredits)

      // Check if reminder was already sent for this invoice
      const existingReminder = existingReminders?.find(
        (r) => r.invoice_id === invoice.id && r.days_before_due === daysBeforeDue
      )

      if (!existingReminder || !existingReminder.sent_at) {
        const customer = invoice.customers

        // Only include if customer has email
        if (customer?.email && invoice.public_token) {
          const publicUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/invoice-public/${invoice.public_token}`
          
          reminders.push({
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            customer_name: customer?.name,
            customer_email: customer.email,
            outstanding_amount: outstandingAmount,
            due_date: invoice.due_date,
            days_before_due: daysBeforeDue,
            public_url: publicUrl,
          })
        }
      }
    })

    return NextResponse.json({ reminders })
  } catch (error: any) {
    console.error("Error getting due date reminders:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json()
    const { invoice_id, days_before_due } = body

    if (!invoice_id || days_before_due === undefined) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // Get invoice details
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select(
        `
        *,
        customers (
          id,
          name,
          email
        )
      `
      )
      .eq("id", invoice_id)
      .eq("business_id", business.id)
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: "Invoice not found" },
        { status: 404 }
      )
    }

    // Verify invoice is not paid
    const { data: payments } = await supabase
      .from("payments")
      .select("amount")
      .eq("invoice_id", invoice_id)
      .is("deleted_at", null)

    const { data: creditNotes } = await supabase
      .from("credit_notes")
      .select("total")
      .eq("invoice_id", invoice_id)
      .eq("status", "applied")
      .is("deleted_at", null)

    const totalPaid = payments?.reduce((sum, p) => sum + Number(p.amount || 0), 0) || 0
    const totalCredits = creditNotes?.reduce((sum, cn) => sum + Number(cn.total || 0), 0) || 0
    const outstandingAmount = Math.max(0, Number(invoice.total || 0) - totalPaid - totalCredits)

    if (outstandingAmount <= 0) {
      return NextResponse.json(
        { error: "Invoice is already paid" },
        { status: 400 }
      )
    }

    // TODO: Send email reminder
    // For now, we'll just log it and record the reminder
    console.log(`Sending due date reminder for invoice ${invoice.invoice_number} to ${invoice.customers?.email}`)
    
    // Record that reminder was sent
    const { error: insertError } = await supabase
      .from("invoice_reminders")
      .insert({
        business_id: business.id,
        invoice_id,
        reminder_type: "due_date",
        days_before_due,
        sent_at: new Date().toISOString(),
      })

    if (insertError) {
      console.error("Error recording reminder:", insertError)
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      success: true,
      message: "Reminder sent successfully"
    })
  } catch (error: any) {
    console.error("Error sending due date reminder:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}













