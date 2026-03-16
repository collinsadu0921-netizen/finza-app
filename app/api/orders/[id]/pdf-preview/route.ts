import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { generateFinancialDocumentHTML, type BusinessInfo, type CustomerInfo, type DocumentItem, type DocumentMeta, type DocumentTotals } from "@/components/documents/FinancialDocument"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const orderId = resolvedParams.id

    if (!orderId) {
      return NextResponse.json(
        { error: "Order ID is required" },
        { status: 400 }
      )
    }

    const supabase = await createSupabaseServerClient()

    // Fetch order with all related data
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(`
        *,
        customers (
          id,
          name,
          email,
          phone,
          whatsapp_phone,
          address
        ),
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
        order_items (
          id,
          description,
          quantity,
          unit_price,
          line_total
        )
      `)
      .eq("id", orderId)
      .single()

    if (orderError || !order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      )
    }

    // Get business info
    let businessData: BusinessInfo = {
      name: order.businesses?.name,
      legal_name: order.businesses?.legal_name,
      trading_name: order.businesses?.trading_name,
      phone: order.businesses?.phone,
      email: order.businesses?.email,
      address: order.businesses?.address,
      logo_url: order.businesses?.logo_url,
      tax_id: order.businesses?.tax_id,
      registration_number: order.businesses?.registration_number,
    }

    if (!businessData.name && order.business_id) {
      const { data: business } = await supabase
        .from("businesses")
        .select("name, legal_name, trading_name, phone, email, address, logo_url, tax_id, registration_number")
        .eq("id", order.business_id)
        .single()
      if (business) {
        businessData = {
          name: business.name,
          legal_name: business.legal_name,
          trading_name: business.trading_name,
          phone: business.phone,
          email: business.email,
          address: business.address,
          logo_url: business.logo_url,
          tax_id: business.tax_id,
          registration_number: business.registration_number,
        }
      }
    }

    const customerData: CustomerInfo = order.customers
      ? {
          id: order.customers.id,
          name: order.customers.name,
          email: order.customers.email,
          phone: order.customers.phone,
          whatsapp_phone: order.customers.whatsapp_phone,
          address: order.customers.address,
        }
      : {
          name: "Customer",
        }

    const documentItems: DocumentItem[] = (order.order_items || []).map((item: any) => ({
      id: item.id,
      description: item.description || "Item",
      quantity: item.quantity || 0,
      unit_price: item.unit_price || 0,
      line_total: item.line_total || 0,
      qty: item.quantity || 0,
      line_subtotal: item.line_total || 0,
    }))

    const documentTotals: DocumentTotals = {
      subtotal: Number(order.subtotal || 0),
      total_tax: Number(order.total_tax || 0),
      total: Number(order.total_amount || 0),
    }

    // Generate order number (short ID)
    const orderNumber = order.id.substring(0, 8).toUpperCase()

    const documentMeta: DocumentMeta = {
      document_number: orderNumber,
      issue_date: order.created_at,
      status: order.status || null,
    }

    // Determine if taxes are applied
    const applyTaxes = order.total_tax && order.total_tax > 0

    // Get currency from business - required for PDF generation
    const businessCurrencyCode = order.businesses?.default_currency
    if (!businessCurrencyCode) {
      return NextResponse.json(
        { error: "Business currency is required for order PDF generation. Please set your default currency in Business Profile settings." },
        { status: 400 }
      )
    }

    // Get currency symbol
    const { getCurrencySymbol } = await import("@/lib/currency")
    const businessCurrencySymbol = getCurrencySymbol(businessCurrencyCode)

    // Generate HTML using shared document component
    const htmlPreview = generateFinancialDocumentHTML({
      documentType: "order",
      business: businessData,
      customer: customerData,
      items: documentItems,
      totals: documentTotals,
      meta: documentMeta,
      notes: order.notes || null,
      footer_message: null,
      apply_taxes: applyTaxes,
      currency_symbol: businessCurrencySymbol,
      currency_code: businessCurrencyCode,
    })

    return new NextResponse(htmlPreview, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    })
  } catch (error: any) {
    console.error("Error generating order preview:", error)
    return NextResponse.json(
      { error: "Failed to generate preview" },
      { status: 500 }
    )
  }
}

