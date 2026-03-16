import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { calculateTaxes } from "@/lib/taxEngine"
import { generateFinancialDocumentHTML, type BusinessInfo, type CustomerInfo, type DocumentItem, type DocumentMeta, type DocumentTotals } from "@/components/documents/FinancialDocument"
import { getCurrencySymbol } from "@/lib/currency"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const {
      customer_id,
      invoice_number,
      issue_date,
      due_date,
      notes,
      footer_message,
      apply_taxes,
      items,
      currency_symbol, // No default - must come from business
      currency_code, // No default - must come from business
    } = body

    if (!customer_id || !invoice_number || !issue_date) {
      return NextResponse.json(
        { error: "Missing required fields: customer_id, invoice_number, or issue_date" },
        { status: 400 }
      )
    }

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
    const finalBusinessId = business.id
    
    // Fetch business and customer data
    // Note: tax_id and registration_number are added via migration 069_add_business_tax_columns.sql
    const { data: businessRow, error: businessError } = await supabase
      .from("businesses")
      .select("name, legal_name, trading_name, phone, email, address, logo_url, tax_id, registration_number, address_country, default_currency")
      .eq("id", finalBusinessId)
      .single()

    if (businessError || !businessRow) {
      return NextResponse.json(
        { error: "Business not found" },
        { status: 404 }
      )
    }

    // Get currency from business (no hard-coded defaults)
    const businessCurrencyCode = currency_code || businessRow.default_currency
    if (!businessCurrencyCode) {
      return NextResponse.json(
        { error: "Business currency is required. Please set your default currency in Business Profile settings." },
        { status: 400 }
      )
    }
    
    // Map currency code to symbol (no hard-coded Cedi)
    const businessCurrencySymbol = currency_symbol || getCurrencySymbol(businessCurrencyCode)

    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id, name, email, phone, whatsapp_phone, address")
      .eq("id", customer_id)
      .single()

    if (businessError || !businessRow) {
      console.error("Business lookup error:", businessError)
      return NextResponse.json(
        { error: `Business not found: ${businessError?.message || 'Business ID: ' + finalBusinessId}` },
        { status: 404 }
      )
    }

    if (customerError || !customer) {
      console.error("Customer lookup error:", customerError)
      return NextResponse.json(
        { error: `Customer not found: ${customerError?.message || 'Customer ID: ' + customer_id}` },
        { status: 404 }
      )
    }

    // Prepare line items for tax calculation
    const lineItems = (items || []).map((item: any) => ({
      quantity: Number(item.qty || item.quantity || 0),
      unit_price: Number(item.unit_price || item.price || 0),
      discount_amount: Number(item.discount_amount || 0),
    }))

    // Calculate totals using new tax engine
    // For preview (unsaved invoice), use issue_date as effective date
    let subtotal = 0
    let total = 0
    let totalTax = 0

    if (apply_taxes && lineItems.length > 0) {
      const taxCalculationResult = calculateTaxes(
        lineItems,
        businessRow?.address_country,
        issue_date, // Use issue_date for preview (invoice hasn't been sent yet)
        true // tax-inclusive pricing
      )
      
      subtotal = taxCalculationResult.subtotal_excl_tax
      totalTax = taxCalculationResult.tax_total
      total = taxCalculationResult.total_incl_tax
    } else {
      // No taxes applied
      subtotal = lineItems.reduce((sum, item) => {
        const lineTotal = item.quantity * item.unit_price
        const discount = item.discount_amount || 0
        return sum + lineTotal - discount
      }, 0)
      total = subtotal
      totalTax = 0
    }

    // Prepare data for shared document component
    const businessData: BusinessInfo = {
      name: businessRow.name,
      legal_name: businessRow.legal_name,
      trading_name: businessRow.trading_name,
      phone: businessRow.phone,
      email: businessRow.email,
      address: businessRow.address,
      logo_url: businessRow.logo_url,
      tax_id: businessRow.tax_id,
      registration_number: businessRow.registration_number,
    }

    const customerData: CustomerInfo = {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      whatsapp_phone: customer.whatsapp_phone,
      address: customer.address,
    }

    const documentItems: DocumentItem[] = (items || []).map((item: any) => {
                  const qty = Number(item.qty || item.quantity || 0)
                  const price = Number(item.unit_price || item.price || 0)
                  const discount = Number(item.discount_amount || 0)
                  const lineTotal = qty * price - discount
      return {
        id: item.id,
        description: item.description || "Item",
        qty,
        unit_price: price,
        discount_amount: discount,
        line_subtotal: lineTotal,
      }
    })

    const documentTotals: DocumentTotals = {
      subtotal,
      total_tax: totalTax,
      total,
    }

    const documentMeta: DocumentMeta = {
      document_number: invoice_number,
      issue_date,
      due_date: due_date || null,
    }

    // Generate HTML preview using shared component
    const htmlPreview = generateFinancialDocumentHTML({
      documentType: "invoice",
      business: businessData,
      customer: customerData,
      items: documentItems,
      totals: documentTotals,
      meta: documentMeta,
      notes: notes || null,
      footer_message: footer_message || null,
      apply_taxes,
      currency_symbol,
      currency_code,
      // Pass tax_lines from calculation result for dynamic rendering
      tax_lines: apply_taxes && taxCalculationResult ? taxCalculationResult.taxLines : undefined,
      business_country: businessRow?.address_country || null,
    })

    return new NextResponse(htmlPreview, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    })
  } catch (error: any) {
    console.error("Error generating preview:", error)
    return NextResponse.json(
      { error: "Failed to generate preview" },
      { status: 500 }
    )
  }
}
