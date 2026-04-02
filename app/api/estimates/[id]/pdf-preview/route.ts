import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireBusinessScopeForUser } from "@/lib/business"
import { generateFinancialDocumentHTML, type BusinessInfo, type CustomerInfo, type DocumentItem, type DocumentMeta, type DocumentTotals } from "@/components/documents/FinancialDocument"
import { estimateLineItemDiscount } from "@/lib/documents/estimateLineItemDiscount"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const estimateId = resolvedParams.id

    if (!estimateId) {
      return NextResponse.json(
        { error: "Estimate ID is required" },
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

    const requestedBusinessId = new URL(request.url).searchParams.get("business_id")
    const scope = await requireBusinessScopeForUser(supabase, user.id, requestedBusinessId)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const scopedBusinessId = scope.businessId

    // Fetch estimate
    const { data: estimateRow, error: estimateError } = await supabase
      .from("estimates")
      .select(`
        *,
        businesses (
          id,
          name,
          legal_name,
          trading_name,
          phone,
          email,
          address,
          logo_url,
          tax_id,
          registration_number,
          default_currency
        ),
        estimate_items (*)
      `)
      .eq("id", estimateId)
      .eq("business_id", scopedBusinessId)
      .single()

    if (estimateError || !estimateRow) {
      return NextResponse.json(
        { error: "Estimate not found" },
        { status: 404 }
      )
    }

    const customerId = estimateRow.customer_id
    let customers: { id: string; name: string; email: string | null; phone: string | null; whatsapp_phone: string | null; address: string | null } | null = null
    if (customerId) {
      const { data: cust } = await supabase
        .from("customers")
        .select("id, name, email, phone, whatsapp_phone, address")
        .eq("id", customerId)
        .single()
      customers = cust ?? null
    }
    const estimate = { ...estimateRow, customers }

    // Prepare data for shared document component
    const business: BusinessInfo = {
      name: estimate.businesses?.name,
      legal_name: estimate.businesses?.legal_name,
      trading_name: estimate.businesses?.trading_name,
      phone: estimate.businesses?.phone,
      email: estimate.businesses?.email,
      address: estimate.businesses?.address,
      logo_url: estimate.businesses?.logo_url,
      tax_id: estimate.businesses?.tax_id,
      registration_number: estimate.businesses?.registration_number,
    }

    const customerData: CustomerInfo = estimate.customers
      ? {
          id: estimate.customers.id,
          name: estimate.customers.name,
          email: estimate.customers.email,
          phone: estimate.customers.phone,
          whatsapp_phone: estimate.customers.whatsapp_phone,
          address: estimate.customers.address,
        }
      : {
          name: "Customer",
        }

    const documentItems: DocumentItem[] = (estimate.estimate_items || []).map((item: any) => {
      const qty = Number(item.quantity ?? item.qty ?? 0)
      const unitPrice = Number(item.price ?? item.unit_price ?? 0)
      const lineNet = Number(item.total ?? item.line_total ?? 0)
      return {
        id: item.id,
        description: item.description || "Item",
        qty,
        unit_price: unitPrice,
        discount_amount: estimateLineItemDiscount(item),
        line_subtotal: lineNet,
      }
    })

    const documentTotals: DocumentTotals = {
      subtotal: Number(estimate.subtotal || 0),
      total_tax: Number(estimate.total_tax_amount || 0),
      total: Number(estimate.total_amount || 0),
      nhil_amount: Number(estimate.nhil_amount || 0),
      getfund_amount: Number(estimate.getfund_amount || 0),
      covid_amount: Number(estimate.covid_amount || 0),
      vat_amount: Number(estimate.vat_amount || 0),
    }

    const documentMeta: DocumentMeta = {
      document_number: estimate.estimate_number,
      issue_date: estimate.issue_date,
      expiry_date: estimate.expiry_date || null,
      status: estimate.status || null,
      public_token: estimate.public_token || null,
    }

    // Determine if taxes are applied (based on whether tax amounts exist)
    const applyTaxes = estimate.total_tax_amount && estimate.total_tax_amount > 0

    // Get currency — prefer stored estimate currency (FX), fall back to business default
    const businessCurrencyCode = estimate.currency_code || estimate.businesses?.default_currency
    if (!businessCurrencyCode) {
      return NextResponse.json(
        { error: "Business currency is required for estimate PDF generation. Please set your default currency in Business Profile settings." },
        { status: 400 }
      )
    }

    // Get currency symbol
    const { getCurrencySymbol } = await import("@/lib/currency")
    const businessCurrencySymbol = getCurrencySymbol(businessCurrencyCode)

    // Generate HTML using shared document component
    const htmlPreview = generateFinancialDocumentHTML({
      documentType: "estimate",
      business,
      customer: customerData,
      items: documentItems,
      totals: documentTotals,
      meta: documentMeta,
      notes: estimate.notes || null,
      footer_message: null,
      apply_taxes: applyTaxes,
      currency_symbol: businessCurrencySymbol,
      currency_code: businessCurrencyCode,
      // FX fields
      fx_rate: estimate.fx_rate ?? null,
      home_currency_code: estimate.home_currency_code ?? null,
      home_currency_total: estimate.home_currency_total ?? null,
    })

    return new NextResponse(htmlPreview, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    })
  } catch (error: any) {
    console.error("Error generating estimate preview:", error)
    return NextResponse.json(
      { error: "Failed to generate preview" },
      { status: 500 }
    )
  }
}

