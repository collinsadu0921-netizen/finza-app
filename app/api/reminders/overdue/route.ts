import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"

export async function GET(request: NextRequest) {
  try {
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

    // Get reminder settings
    const { data: reminderSettings } = await supabase
      .from("business_reminder_settings")
      .select("*")
      .eq("business_id", business.id)
      .maybeSingle()

    if (!reminderSettings || !reminderSettings.overdue_reminders_enabled) {
      return NextResponse.json({
        reminders: [],
        message: "Overdue reminders are not enabled",
      })
    }

    const reminderFrequencies = reminderSettings.reminder_frequency_days || [3, 7, 14]
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Get invoices with due_date < today (we'll filter by outstanding_amount in memory)
    // Do NOT filter by status - use financial state calculation instead
    const { data: allInvoices, error: invoicesError } = await supabase
      .from("invoices")
      .select(
        `
        id,
        invoice_number,
        due_date,
        total,
        public_token,
        customers (
          id,
          name,
          whatsapp_phone,
          phone
        )
      `
      )
      .eq("business_id", business.id)
      .not("due_date", "is", null)
      .lt("due_date", today.toISOString().split("T")[0])
      .is("deleted_at", null)

    if (invoicesError) {
      console.error("Error fetching invoices:", invoicesError)
      return NextResponse.json(
        { error: invoicesError.message },
        { status: 500 }
      )
    }

    if (!allInvoices || allInvoices.length === 0) {
      return NextResponse.json({ reminders: [] })
    }

    // Get all payments and credit notes to calculate outstanding amounts
    const invoiceIds = allInvoices.map((inv: any) => inv.id)
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

    // Calculate outstanding amounts and filter to only overdue invoices
    // Overdue = outstanding_amount > 0 AND due_date < today
    // Paid invoices (outstanding_amount = 0) must be excluded
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

    const overdueInvoices = allInvoices.filter((inv: any) => {
      // Exclude draft invoices (not yet issued)
      if (inv.status === "draft") {
        return false
      }
      
      const totalPaid = invoicePaymentsMap[inv.id] || 0
      const totalCredits = invoiceCreditNotesMap[inv.id] || 0
      const outstandingAmount = Math.max(0, Number(inv.total || 0) - totalPaid - totalCredits)
      
      // Exclude fully paid invoices (outstanding_amount = 0)
      return outstandingAmount > 0
    })

    // Get existing reminders
    const { data: existingReminders } = await supabase
      .from("invoice_reminders")
      .select("invoice_id, days_after_due, sent_at")
      .in("invoice_id", invoiceIds)

    const reminders: any[] = []

      ; (overdueInvoices || []).forEach((invoice: any) => {
        // Outstanding amount already calculated above, invoices are pre-filtered
        // We know outstandingAmount > 0 for all invoices in this array

        const dueDate = new Date(invoice.due_date)
        const daysPastDue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))

        // Check if reminder should be sent for this days_past_due
        reminderFrequencies.forEach((daysAfterDue: number) => {
          if (daysPastDue >= daysAfterDue) {
            // Check if reminder was already sent for this days_after_due
            const existingReminder = existingReminders?.find(
              (r) => r.invoice_id === invoice.id && r.days_after_due === daysAfterDue
            )

            if (!existingReminder || !existingReminder.sent_at) {
              const customer = invoice.customers
              const phone = customer?.whatsapp_phone || customer?.phone

              if (phone && invoice.public_token) {
                // Calculate outstanding balance for this invoice
                const totalPaid = invoicePaymentsMap[invoice.id] || 0
                const totalCredits = invoiceCreditNotesMap[invoice.id] || 0
                const balance = Math.max(0, Number(invoice.total || 0) - totalPaid - totalCredits)

                const cleanPhone = phone.replace(/\s+/g, "").replace(/^0/, "+233")
                const publicUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/invoice-public/${invoice.public_token}`
                const businessName =
                  business.trading_name || business.legal_name || business.name || "Your supplier"
                const rawTemplate = (reminderSettings.reminder_message_template || "").trim()
                const message = rawTemplate
                  ? rawTemplate
                      .replace(/\[CustomerName\]/g, customer?.name || "Customer")
                      .replace(/\[InvoiceNumber\]/g, String(invoice.invoice_number || ""))
                      .replace(/\[Link\]/g, publicUrl)
                      .replace(/\[BusinessName\]/g, businessName)
                      .replace(/\[Amount\]/g, "")
                      .replace(/\[CurrencySymbol\]/g, "")
                  : `Hello ${customer?.name || "Customer"},

This is a reminder regarding invoice ${invoice.invoice_number} from ${businessName}.

View invoice:
${publicUrl}

Thank you,
${businessName}`

                reminders.push({
                  invoice_id: invoice.id,
                  invoice_number: invoice.invoice_number,
                  customer_name: customer?.name,
                  phone: cleanPhone,
                  balance,
                  daysPastDue,
                  daysAfterDue,
                  message,
                  whatsappUrl: `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`,
                })
              }
            }
          }
        })
      })

    return NextResponse.json({ reminders })
  } catch (error: any) {
    console.error("Error getting overdue reminders:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
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
    const { invoice_id, days_after_due } = body

    if (!invoice_id || days_after_due === undefined) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // Record that reminder was sent
    const { error: insertError } = await supabase
      .from("invoice_reminders")
      .insert({
        business_id: business.id,
        invoice_id,
        reminder_type: "overdue",
        days_after_due,
        sent_at: new Date().toISOString(),
      })

    if (insertError) {
      console.error("Error recording reminder:", insertError)
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error recording reminder:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

