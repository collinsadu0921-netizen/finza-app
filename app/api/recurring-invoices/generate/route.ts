import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { deriveLegacyTaxColumnsFromTaxLines } from "@/lib/taxEngine/helpers"
import { getCurrencySymbol } from "@/lib/currency"
import { buildWhatsAppLink } from "@/lib/communication/whatsappLink"

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
    const { recurring_invoice_id } = body

    if (!recurring_invoice_id) {
      return NextResponse.json(
        { error: "recurring_invoice_id is required" },
        { status: 400 }
      )
    }

    // Get recurring invoice
    const { data: recurringInvoice, error: fetchError } = await supabase
      .from("recurring_invoices")
      .select("*")
      .eq("id", recurring_invoice_id)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (fetchError || !recurringInvoice) {
      return NextResponse.json(
        { error: "Recurring invoice not found" },
        { status: 404 }
      )
    }

    if (recurringInvoice.status !== "active") {
      return NextResponse.json(
        { error: "Recurring invoice is not active" },
        { status: 400 }
      )
    }

    // Get invoice settings for defaults
    const { data: invoiceSettings } = await supabase
      .from("invoice_settings")
      .select("*")
      .eq("business_id", business.id)
      .maybeSingle()

    // Extract template data (canonical: use stored tax_lines and totals; no recalculation)
    const templateData = recurringInvoice.invoice_template_data || {}
    const lineItems = templateData.line_items || []
    const applyTaxes = templateData.apply_taxes === true
    const paymentTerms = templateData.payment_terms || invoiceSettings?.default_payment_terms || null
    const notes = templateData.notes || null

    // Invoice number is system-controlled: only assign when status is "sent"
    const willBeSent = recurringInvoice.auto_send || false
    let invoiceNumber: string | null = null
    if (willBeSent) {
      const { data: invoiceNumData } = await supabase.rpc("generate_invoice_number_with_settings", {
        business_uuid: business.id,
      })
      invoiceNumber = invoiceNumData || null
      if (!invoiceNumber) {
        console.error("Failed to generate invoice number for recurring invoice")
      }
    }

    const issueDate = new Date().toISOString().split("T")[0]

    // Use stored canonical totals and tax_lines from template (recurring is orchestration only)
    let baseSubtotal: number
    let invoiceTotal: number
    let totalTax: number
    let storedTaxLines: Record<string, unknown> | null = null
    let taxEngineCode: string | null = null
    let taxEngineEffectiveFrom: string | null = null
    let taxJurisdiction: string | null = null
    let legacyGhanaTaxes = { nhil: 0, getfund: 0, covid: 0, vat: 0 }

    if (applyTaxes && templateData.tax_lines?.lines != null) {
      storedTaxLines = templateData.tax_lines as Record<string, unknown>
      const lines = (templateData.tax_lines as { lines?: Array<{ code: string; amount: number }> }).lines ?? []
      legacyGhanaTaxes = deriveLegacyTaxColumnsFromTaxLines(lines)
      baseSubtotal = Number(templateData.subtotal) || 0
      totalTax = Number(templateData.total_tax) || 0
      invoiceTotal = Number(templateData.total) || baseSubtotal + totalTax
      taxEngineCode = (templateData.tax_engine_code as string) || null
      taxEngineEffectiveFrom = (templateData.tax_engine_effective_from as string) || null
      taxJurisdiction = (templateData.tax_jurisdiction as string) || null
    } else {
      const subtotal = (lineItems as any[]).reduce((sum: number, item: any) => {
        const lineTotal = (Number(item.qty) || 0) * (Number(item.unit_price) || 0)
        const discount = Number(item.discount_amount) || 0
        return sum + lineTotal - discount
      }, 0)
      baseSubtotal = subtotal
      totalTax = 0
      invoiceTotal = subtotal
    }
    const dueDays = invoiceSettings?.due_days_default || 30
    const dueDate = new Date(issueDate)
    dueDate.setDate(dueDate.getDate() + dueDays)

    const { data: tokenData } = await supabase.rpc("generate_public_token")
    const publicToken = tokenData || Buffer.from(`${business.id}-${Date.now()}`).toString("base64url")

    const sentAtDate = recurringInvoice.auto_send ? new Date().toISOString() : null

    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .insert({
        business_id: business.id,
        customer_id: recurringInvoice.customer_id,
        invoice_number: invoiceNumber,
        issue_date: issueDate,
        due_date: dueDate.toISOString().split("T")[0],
        payment_terms: paymentTerms,
        notes: notes,
        apply_taxes: applyTaxes,
        subtotal: baseSubtotal,
        total_tax: totalTax,
        total: invoiceTotal,
        status: recurringInvoice.auto_send ? "sent" : "draft",
        public_token: publicToken,
        sent_at: sentAtDate,
        tax_lines: applyTaxes && storedTaxLines ? storedTaxLines : null,
        tax_engine_code: applyTaxes ? taxEngineCode : null,
        tax_engine_effective_from: applyTaxes ? taxEngineEffectiveFrom : null,
        tax_jurisdiction: applyTaxes ? taxJurisdiction : null,
        nhil: applyTaxes ? Math.round(legacyGhanaTaxes.nhil * 100) / 100 : 0,
        getfund: applyTaxes ? Math.round(legacyGhanaTaxes.getfund * 100) / 100 : 0,
        covid: applyTaxes ? Math.round(legacyGhanaTaxes.covid * 100) / 100 : 0,
        vat: applyTaxes ? Math.round(legacyGhanaTaxes.vat * 100) / 100 : 0,
      })
      .select()
      .single()

    if (invoiceError) {
      console.error("Error creating invoice:", invoiceError)
      return NextResponse.json(
        { error: invoiceError.message },
        { status: 500 }
      )
    }

    // Create invoice items
    if (lineItems.length > 0) {
      const invoiceItems = lineItems.map((item: any) => ({
        invoice_id: invoice.id,
        product_service_id: item.product_service_id || null,
        description: item.description || "",
        qty: Number(item.qty) || 0,
        unit_price: Number(item.unit_price) || 0,
        discount_amount: Number(item.discount_amount) || 0,
        line_subtotal: (Number(item.qty) || 0) * (Number(item.unit_price) || 0) - (Number(item.discount_amount) || 0),
      }))

      const { error: itemsError } = await supabase
        .from("invoice_items")
        .insert(invoiceItems)

      if (itemsError) {
        console.error("Error creating invoice items:", itemsError)
        // Delete invoice if items fail
        await supabase.from("invoices").delete().eq("id", invoice.id)
        return NextResponse.json(
          { error: itemsError.message },
          { status: 500 }
        )
      }
    }

    // Update recurring invoice
    const { data: nextRunDate } = await supabase.rpc("calculate_next_run_date", {
      p_current_date: issueDate,
      p_frequency: recurringInvoice.frequency,
    })

    await supabase
      .from("recurring_invoices")
      .update({
        last_run_date: issueDate,
        next_run_date: nextRunDate || issueDate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", recurring_invoice_id)

    // If auto_whatsapp is enabled, return WhatsApp info
    let whatsappInfo = null
    if (recurringInvoice.auto_whatsapp) {
      // Get customer info
      const { data: customer } = await supabase
        .from("customers")
        .select("name, whatsapp_phone, phone")
        .eq("id", recurringInvoice.customer_id)
        .single()

      if (customer) {
        const phone = customer.whatsapp_phone || customer.phone
        if (phone) {
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
          const publicUrl = `${baseUrl}/invoice-public/${publicToken}`
          const currencySymbol = invoice.currency_code
            ? getCurrencySymbol(invoice.currency_code)
            : null
          const currencyCode = invoice.currency_code || ""
          const message = `Hello ${customer.name}, your recurring invoice ${invoiceNumber} from ${business.name || "Business"} is ready:\n\n${publicUrl}\n\nTotal: ${currencySymbol || currencyCode}${invoiceTotal.toFixed(2)}.`
          const linkResult = buildWhatsAppLink(phone, message)
          if (linkResult.ok) {
            whatsappInfo = {
              phone: `+${linkResult.digits}`,
              message,
              url: linkResult.whatsappUrl,
            }
          }
        }
      }
    }

    return NextResponse.json({
      invoice,
      whatsappInfo,
    })
  } catch (error: any) {
    console.error("Error generating recurring invoice:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
