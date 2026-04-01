import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createAuditLog } from "@/lib/auditLog"

// Note: This endpoint should be called by a cron job or scheduled task
// Example cron job setup:
// - Vercel Cron: Add to vercel.json
// - External service: Call POST /api/reminders/process-automated with API key
// - Supabase Edge Functions: Set up scheduled function

/**
 * Automated Reminder Processing Endpoint
 * 
 * This endpoint should be called by a cron job daily (or on schedule)
 * to process overdue invoice reminders.
 * 
 * Security: Uses API key or service role authentication
 * 
 * Process:
 * 1. Find all businesses with overdue reminders enabled
 * 2. For each business, find overdue invoices (derived payment state)
 * 3. Check if reminder should be sent based on interval
 * 4. Send email reminders
 * 5. Record reminders sent and calculate next reminder date
 */

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    
    // Optional: Add API key authentication for cron job security
    const authHeader = request.headers.get("authorization")
    const expectedApiKey = process.env.REMINDER_API_KEY
    if (expectedApiKey && authHeader !== `Bearer ${expectedApiKey}`) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split("T")[0]

    // Get all businesses with overdue reminders enabled
    const { data: reminderSettings, error: settingsError } = await supabase
      .from("business_reminder_settings")
      .select(
        `
        *,
        businesses (
          id,
          name,
          legal_name,
          trading_name
        )
      `
      )
      .eq("overdue_reminders_enabled", true)
      .eq("email_reminders_enabled", true)

    if (settingsError) {
      console.error("Error fetching reminder settings:", settingsError)
      return NextResponse.json(
        { error: settingsError.message },
        { status: 500 }
      )
    }

    if (!reminderSettings || reminderSettings.length === 0) {
      return NextResponse.json({
        processed: 0,
        reminders_sent: 0,
        message: "No businesses with email reminders enabled",
      })
    }

    let totalProcessed = 0
    let totalRemindersSent = 0
    const errors: string[] = []

    // Process each business
    for (const setting of reminderSettings) {
      try {
        const businessId = setting.business_id
        const intervalDays = setting.reminder_interval_days || 7

        // Find overdue invoices for this business
        // Overdue = outstanding_amount > 0 AND due_date < today
        const { data: allInvoices, error: invoicesError } = await supabase
          .from("invoices")
          .select(
            `
            id,
            invoice_number,
            due_date,
            total,
            subtotal,
            vat,
            public_token,
            business_id,
            customers (
              id,
              name,
              email
            )
          `
          )
          .eq("business_id", businessId)
          .not("due_date", "is", null)
          .lt("due_date", todayStr)
          .neq("status", "draft")
          .is("deleted_at", null)

        if (invoicesError) {
          console.error(`Error fetching invoices for business ${businessId}:`, invoicesError)
          errors.push(`Business ${businessId}: ${invoicesError.message}`)
          continue
        }

        if (!allInvoices || allInvoices.length === 0) {
          continue
        }

        // Get payments and credit notes to calculate outstanding amounts
        const invoiceIds = allInvoices.map((inv: any) => inv.id)
        const { data: payments } = await supabase
          .from("payments")
          .select("invoice_id, amount")
          .in("invoice_id", invoiceIds)
          .is("deleted_at", null)

        const { data: creditNotes } = await supabase
          .from("credit_notes")
          .select("invoice_id, total")
          .in("invoice_id", invoiceIds)
          .eq("status", "applied")
          .is("deleted_at", null)

        // Calculate outstanding amounts
        const paymentTotals: Record<string, number> = {}
        payments?.forEach((p: any) => {
          paymentTotals[p.invoice_id] = (paymentTotals[p.invoice_id] || 0) + Number(p.amount || 0)
        })

        const creditNoteTotals: Record<string, number> = {}
        creditNotes?.forEach((cn: any) => {
          creditNoteTotals[cn.invoice_id] = (creditNoteTotals[cn.invoice_id] || 0) + Number(cn.total || 0)
        })

        // Filter to only overdue invoices (outstanding > 0)
        const overdueInvoices = allInvoices.filter((inv: any) => {
          const totalPaid = paymentTotals[inv.id] || 0
          const totalCredits = creditNoteTotals[inv.id] || 0
          const outstandingAmount = Math.max(0, Number(inv.total || 0) - totalPaid - totalCredits)
          return outstandingAmount > 0
        })

        totalProcessed += overdueInvoices.length

        // Get existing reminders for these invoices
        const { data: existingReminders } = await supabase
          .from("invoice_reminders")
          .select("invoice_id, sent_at, next_reminder_date, reminder_method")
          .in("invoice_id", invoiceIds)

        // Process each overdue invoice
        for (const invoice of overdueInvoices) {
          try {
            const outstandingAmount = Math.max(
              0,
              Number(invoice.total || 0) - (paymentTotals[invoice.id] || 0) - (creditNoteTotals[invoice.id] || 0)
            )

            // Skip if fully paid (shouldn't happen due to filter, but double-check)
            if (outstandingAmount <= 0) {
              // Clear any existing next_reminder_date for this invoice
              await supabase
                .from("invoice_reminders")
                .update({ next_reminder_date: null })
                .eq("invoice_id", invoice.id)
                .not("next_reminder_date", "is", null)
              continue
            }

            // Check if we should send a reminder
            const dueDate = new Date(invoice.due_date)
            const invoiceReminders = existingReminders?.filter((r) => r.invoice_id === invoice.id) || []
            const lastReminder = invoiceReminders
              .filter((r) => r.sent_at)
              .sort((a, b) => new Date(b.sent_at!).getTime() - new Date(a.sent_at!).getTime())[0]

            let shouldSendReminder = false

            if (!lastReminder || !lastReminder.sent_at) {
              // First reminder - send immediately if overdue
              shouldSendReminder = true
            } else {
              // Check if next reminder date has arrived
              const lastSentDate = new Date(lastReminder.sent_at)
              lastSentDate.setHours(0, 0, 0, 0)
              
              if (lastReminder.next_reminder_date) {
                const nextDate = new Date(lastReminder.next_reminder_date)
                nextDate.setHours(0, 0, 0, 0)
                shouldSendReminder = today >= nextDate
              } else {
                // Calculate next date from last sent date
                const nextDate = new Date(lastSentDate)
                nextDate.setDate(nextDate.getDate() + intervalDays)
                shouldSendReminder = today >= nextDate
              }
            }

            if (!shouldSendReminder) {
              continue
            }

            // Check if customer has email
            const customer = Array.isArray(invoice.customers) ? invoice.customers[0] : invoice.customers
            const customerEmail = customer?.email
            if (!customerEmail) {
              console.log(`Skipping invoice ${invoice.invoice_number}: no customer email`)
              continue
            }

            // Send email reminder
            const biz = setting.businesses as { trading_name?: string; legal_name?: string; name?: string } | null
            const businessName = biz?.trading_name || biz?.legal_name || biz?.name || "Your supplier"

            const emailSent = await sendReminderEmail({
              invoice,
              customerEmail,
              setting,
              businessName,
            })

            if (emailSent) {
              // Calculate next reminder date
              const nextReminderDate = new Date(today)
              nextReminderDate.setDate(nextReminderDate.getDate() + intervalDays)

              // Record reminder sent
              const { error: reminderError } = await supabase
                .from("invoice_reminders")
                .insert({
                  business_id: businessId,
                  invoice_id: invoice.id,
                  reminder_type: "overdue",
                  reminder_method: "email",
                  sent_at: new Date().toISOString(),
                  next_reminder_date: nextReminderDate.toISOString().split("T")[0],
                })

              if (reminderError) {
                console.error(`Error recording reminder for invoice ${invoice.id}:`, reminderError)
                errors.push(`Invoice ${invoice.invoice_number}: Failed to record reminder`)
              } else {
                totalRemindersSent++

                // Log audit entry
                try {
                  await createAuditLog({
                    businessId,
                    userId: null, // System-initiated
                    actionType: "invoice.reminder_sent",
                    entityType: "invoice",
                    entityId: invoice.id,
                    newValues: {
                      invoice_number: invoice.invoice_number,
                      recipient_email: customerEmail,
                      outstanding_amount: outstandingAmount,
                      reminder_method: "email",
                    },
                    description: `Automated reminder email sent for overdue invoice ${invoice.invoice_number}`,
                    request,
                  })
                } catch (auditError) {
                  console.error("Error logging audit:", auditError)
                }
              }
            }
          } catch (invoiceError: any) {
            console.error(`Error processing invoice ${invoice.id}:`, invoiceError)
            errors.push(`Invoice ${invoice.invoice_number}: ${invoiceError.message}`)
          }
        }
      } catch (businessError: any) {
        console.error(`Error processing business ${setting.business_id}:`, businessError)
        errors.push(`Business ${setting.business_id}: ${businessError.message}`)
      }
    }

    return NextResponse.json({
      success: true,
      processed: totalProcessed,
      reminders_sent: totalRemindersSent,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error: any) {
    console.error("Error processing automated reminders:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * Send reminder email to customer
 * TODO: Integrate with actual email service when available
 */
async function sendReminderEmail({
  invoice,
  customerEmail,
  setting,
  businessName,
}: {
  invoice: any
  customerEmail: string
  setting: any
  businessName: string
}): Promise<boolean> {
  try {
    // Generate email content (no monetary amounts in body — details on public invoice page)
    const publicUrl = invoice.public_token
      ? `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/invoice-public/${invoice.public_token}`
      : ""

    const template = setting.email_reminder_template ||
      `Hello {{customer_name}},

This is a reminder regarding invoice {{invoice_number}} from {{business_name}}.

View invoice:
{{invoice_url}}

Thank you,
{{business_name}}`

    const emailBody = template
      .replace(/{{customer_name}}/g, invoice.customers?.name || "Customer")
      .replace(/{{invoice_number}}/g, invoice.invoice_number || "")
      .replace(/{{outstanding_amount}}/g, "")
      .replace(/{{due_date}}/g, invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : "")
      .replace(/{{invoice_url}}/g, publicUrl)
      .replace(/{{currency_symbol}}/g, "")
      .replace(/{{business_name}}/g, businessName)

    const emailSubject = `Payment Reminder: Invoice ${invoice.invoice_number} is Overdue`

    // TODO: Implement actual email sending here
    // For now, log the email that would be sent
    console.log("=".repeat(50))
    console.log("REMINDER EMAIL (TO BE SENT):")
    console.log(`To: ${customerEmail}`)
    console.log(`Subject: ${emailSubject}`)
    console.log(`Body:\n${emailBody}`)
    console.log("=".repeat(50))

    // When email service is integrated, replace above with:
    // await sendEmail({
    //   to: customerEmail,
    //   subject: emailSubject,
    //   body: emailBody,
    //   // Optionally attach invoice PDF
    // })

    return true // Return true for now to allow reminder tracking
  } catch (error) {
    console.error("Error sending reminder email:", error)
    return false
  }
}

