import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { getTaxEngineCode, deriveLegacyTaxColumnsFromTaxLines, getCanonicalTaxResultFromLineItems } from "@/lib/taxEngine/helpers"
import { toTaxLinesJsonb } from "@/lib/taxEngine/serialize"
import { createAuditLog } from "@/lib/auditLog"
import { getCurrencySymbol } from "@/lib/currency"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { assertCountryCurrency } from "@/lib/countryCurrency"
import type { TaxEngineConfig } from "@/lib/taxEngine/types"

/**
 * Convert an order to an invoice
 * 
 * This endpoint:
 * 1. Loads the order and order_items
 * 2. Creates a new invoice and invoice_items using the same logic as /api/invoices/create
 * 3. Links the invoice back to the order (sets orders.invoice_id)
 * 4. Updates order status to 'converted' (terminal commercial state)
 * 
 * STATUS HANDLING:
 * When an order is converted to invoice, we set status = 'converted'.
 * Schema (migration 208): orders.status IN ('draft','issued','converted','cancelled').
 * 'converted' means the order has been invoiced and is read-only.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle Next.js 16 params (can be a Promise)
    const resolvedParams = await Promise.resolve(params)
    const orderId = resolvedParams.id

    if (!orderId) {
      return NextResponse.json(
        { error: "Order ID is required" },
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
      return NextResponse.json({ error: "Business not found" }, { status: 403 })
    }

    // Safely parse request body
    let body: any = {}
    try {
      body = await request.json()
    } catch (parseError) {
      // If body is empty or invalid JSON, use defaults
      body = {}
    }
    const {
      issue_date,
      due_date,
      invoice_number,
    } = body

    // Fetch order with customer — scoped to session business only
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(
        `
        *,
        customers (
          id,
          name,
          email,
          phone,
          address
        )
      `
      )
      .eq("id", orderId)
      .eq("business_id", business.id)
      .single()

    if (orderError || !order) {
      return NextResponse.json(
        { error: "Order not found or you do not have access to it" },
        { status: 403 }
      )
    }

    // Validate order can be converted (schema: converted | legacy invoiced; invoice_id is authoritative)
    if (order.status === "converted" || order.status === "invoiced" || order.invoice_id) {
      return NextResponse.json(
        { error: "Order has already been converted to an invoice" },
        { status: 400 }
      )
    }

    if (order.status === "cancelled") {
      return NextResponse.json(
        { error: "Cannot convert a cancelled order to an invoice" },
        { status: 400 }
      )
    }

    // Fetch order items
    const { data: orderItems, error: itemsError } = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", orderId)

    if (itemsError) {
      console.error("Error fetching order items:", itemsError)
      return NextResponse.json(
        { error: "Failed to load order items" },
        { status: 500 }
      )
    }

    if (!orderItems || orderItems.length === 0) {
      return NextResponse.json(
        { error: "Order has no items" },
        { status: 400 }
      )
    }

    // Get business for currency and country (required for Batch 1 enforcement)
    const { data: businessRecord } = await supabase
      .from("businesses")
      .select("address_country, default_currency")
      .eq("id", order.business_id)
      .single()

    // BLOCK invoice creation if business country is missing (no silent fallback)
    if (!businessRecord?.address_country) {
      return NextResponse.json(
        { 
          success: false,
          error: "Business country is required. Please set your business country in Business Profile settings.",
          message: "Country required for invoice creation"
        },
        { status: 400 }
      )
    }

    // Get currency from business settings (no hard-coded defaults)
    const businessCurrencyCode = businessRecord?.default_currency
    if (!businessCurrencyCode) {
      return NextResponse.json(
        { 
          success: false,
          error: "Business currency is required. Please set your default currency in Business Profile settings.",
          message: "Currency required for invoice creation"
        },
        { status: 400 }
      )
    }
    
    // Validate country-currency match
    const countryCode = normalizeCountry(businessRecord.address_country)
    try {
      assertCountryCurrency(countryCode, businessCurrencyCode)
    } catch (error: any) {
      return NextResponse.json(
        { 
          success: false,
          error: error.message || "Currency does not match business country.",
          message: error.message || "Currency-country mismatch"
        },
        { status: 400 }
      )
    }
    
    // Map currency code to symbol (no hard-coded Cedi)
    const businessCurrencySymbol = getCurrencySymbol(businessCurrencyCode)
    if (!businessCurrencySymbol) {
      return NextResponse.json(
        { 
          success: false,
          error: "Currency symbol could not be determined. Please verify your currency code is valid.",
          message: "Invalid currency code"
        },
        { status: 400 }
      )
    }

    // Get invoice settings for defaults
    const { data: invoiceSettings } = await supabase
      .from("invoice_settings")
      .select("*")
      .eq("business_id", order.business_id)
      .maybeSingle()

    // Invoice number is system-controlled: only assign when status is "sent"
    // For draft invoices created from orders, invoice_number will be null until the invoice is issued
    let finalInvoiceNumber: string | null = null

    // Calculate due date if not provided
    let finalDueDate = due_date
    if (!finalDueDate && issue_date && invoiceSettings?.due_days_default) {
      const issueDate = new Date(issue_date)
      issueDate.setDate(issueDate.getDate() + invoiceSettings.due_days_default)
      finalDueDate = issueDate.toISOString().split("T")[0]
    }

    // Use default payment terms and footer if not provided
    const finalPaymentTerms = invoiceSettings?.default_payment_terms || null
    const finalFooterMessage = invoiceSettings?.default_footer_message || null

    // Prepare order reference note (preserve order reference)
    // Use order ID as reference since orders table doesn't have order_number
    const orderReference = `ORD-${order.id.substring(0, 8).toUpperCase()}`
    const orderReferenceNote = order.notes 
      ? `${order.notes}\n\nCreated from Order: ${orderReference}`
      : `Created from Order: ${orderReference}`

    // Prepare invoice items (map from order_items to invoice_items format)
    // Note: invoice_items uses 'qty' not 'quantity'
    // IMPORTANT: order_items uses 'quantity', invoice_items uses 'qty'
    console.log("📦 Converting order items to invoice items:", JSON.stringify(orderItems, null, 2))
    
    const invoiceItems = orderItems.map((item: any) => {
      // Get quantity from order_items (which uses 'quantity' column)
      const qty = Number(item.quantity ?? item.qty ?? 0)
      const unitPrice = Number(item.unit_price ?? 0)
      
      // Always recalculate line_subtotal from qty and unit_price to ensure consistency
      // Don't trust line_total from order_items as it might be stale
      const lineSubtotal = qty * unitPrice
      
      const invoiceItem = {
        product_service_id: item.product_service_id || null,
        description: item.description || "",
        qty: qty,
        unit_price: unitPrice,
        discount_amount: 0, // Orders don't have discounts in current schema
        line_subtotal: lineSubtotal,
      }
      
      console.log(`✅ Converted item: qty=${qty}, unit_price=${unitPrice}, line_subtotal=${lineSubtotal}`)
      return invoiceItem
    })

    // Prepare line items for tax calculation
    const lineItems = invoiceItems.map((item: any) => ({
      quantity: Number(item.qty) || 0,
      unit_price: Number(item.unit_price) || 0,
      discount_amount: Number(item.discount_amount) || 0,
    }))

    // Validate line items
    for (const item of lineItems) {
      if (isNaN(item.quantity) || item.quantity < 0 || 
          isNaN(item.unit_price) || item.unit_price < 0 || 
          isNaN(item.discount_amount) || item.discount_amount < 0) {
        return NextResponse.json(
          { 
            success: false,
            error: "Invalid line items. Please check quantities and prices.",
            message: "Line item validation failed"
          },
          { status: 400 }
        )
      }
    }

    // Determine effective date: use invoice issue/sent date (not order date)
    // Draft: use issue_date (or current date if not provided)
    // Sent: use sent_at (current date) - but for conversion, we default to draft
    const invoiceIssueDate = issue_date || new Date().toISOString().split("T")[0]
    const effectiveDate = invoiceIssueDate.split('T')[0] // YYYY-MM-DD format

    // Determine if taxes should be applied (based on order, but recompute based on invoice date)
    const applyTaxes = Number(order.total_tax) > 0 || order.apply_taxes === true

    // Recompute taxes using canonical tax engine (DO NOT reuse order tax fields)
    // Effective date is based on INVOICE date, not order date
    const jurisdiction = countryCode
    if (!jurisdiction) {
      return NextResponse.json({ error: "Jurisdiction required", message: "Business country could not be resolved for tax calculation." }, { status: 400 })
    }
    const taxEngineCode = getTaxEngineCode(jurisdiction)
    let taxResult: import('@/lib/taxEngine/types').TaxResult | null = null
    let baseSubtotal: number
    let invoiceTotal: number
    let legacyTaxColumns: { nhil: number; getfund: number; covid: number; vat: number }
    
    if (applyTaxes) {
      // Use canonical tax engine with invoice effective date
      const config: TaxEngineConfig = {
        jurisdiction,
        effectiveDate,
        taxInclusive: true, // Invoices always use tax-inclusive pricing
      }
      
      taxResult = getCanonicalTaxResultFromLineItems(lineItems, config)
      
      // Persist canonical values (rounded to 2dp)
      baseSubtotal = Math.round(taxResult.base_amount * 100) / 100
      invoiceTotal = Math.round(taxResult.total_amount * 100) / 100
      
      // Derive legacy columns from canonical tax lines (no rate logic, no cutoff logic, no country branching)
      legacyTaxColumns = deriveLegacyTaxColumnsFromTaxLines(taxResult.lines)
    } else {
      // No taxes applied
      const subtotal = lineItems.reduce((sum, item) => {
        const lineTotal = item.quantity * item.unit_price
        const discount = item.discount_amount || 0
        return sum + lineTotal - discount
      }, 0)
      
      baseSubtotal = Math.round(subtotal * 100) / 100
      invoiceTotal = Math.round(subtotal * 100) / 100
      legacyTaxColumns = { nhil: 0, getfund: 0, covid: 0, vat: 0 }
    }
    
    // Validate calculated values
    if (isNaN(baseSubtotal) || baseSubtotal < 0 || isNaN(invoiceTotal) || invoiceTotal < 0) {
      console.error("Invalid tax calculation:", { baseSubtotal, invoiceTotal, taxResult })
      return NextResponse.json(
        { 
          success: false,
          error: "Invalid tax calculation. Please check line items and try again.",
          message: "Tax calculation error"
        },
        { status: 400 }
      )
    }

    // Validate legacy tax columns
    for (const [key, value] of Object.entries(legacyTaxColumns)) {
      if (isNaN(value) || value < 0) {
        console.error(`Invalid ${key} calculated:`, value)
        return NextResponse.json(
          { 
            success: false,
            error: `Invalid ${key} calculated. Please check tax settings and try again.`,
            message: "Tax calculation error"
          },
          { status: 400 }
        )
      }
    }

    // Generate public token for invoice (ensure uniqueness)
    let publicToken: string = ""
    let tokenAttempts = 0
    const maxTokenAttempts = 5
    
    while (tokenAttempts < maxTokenAttempts) {
      try {
        const { data: tokenData } = await supabase.rpc("generate_public_token")
        publicToken = tokenData || Buffer.from(`${order.business_id}-${Date.now()}-${Math.random()}`).toString("base64url")
      } catch (tokenError) {
        // Fallback if RPC function doesn't exist
        publicToken = Buffer.from(`${order.business_id}-${Date.now()}-${Math.random()}`).toString("base64url")
      }
      
      // Check if token already exists
      const { data: existingInvoice } = await supabase
        .from("invoices")
        .select("id")
        .eq("public_token", publicToken)
        .maybeSingle()
      
      if (!existingInvoice) {
        break // Token is unique, proceed
      }
      
      tokenAttempts++
      if (tokenAttempts >= maxTokenAttempts) {
        console.error("Failed to generate unique public token after multiple attempts")
        return NextResponse.json(
          {
            success: false,
            error: "Failed to generate unique invoice identifier. Please try again.",
            message: "Token generation failed",
          },
          { status: 500 }
        )
      }
    }
    
    // Final check that we have a valid token
    if (!publicToken) {
      return NextResponse.json(
        {
          success: false,
          error: "Failed to generate invoice identifier. Please try again.",
          message: "Token generation failed",
        },
        { status: 500 }
      )
    }

    // Validate required fields before creating invoice
    if (!order.business_id) {
      return NextResponse.json(
        {
          success: false,
          error: "Order is missing business_id. Cannot create invoice.",
          message: "Invalid order data",
        },
        { status: 400 }
      )
    }

    // Determine effective status early so we can generate invoice_number when creating as "sent"
    // INVARIANT 6: status = 'sent' ⇒ invoice_number MUST exist. Generate before creating invoice.
    const invoiceStatus = body.status || "draft"
    if (invoiceStatus === "sent") {
      const { data: invoiceNumData } = await supabase.rpc("generate_invoice_number_with_settings", {
        business_uuid: order.business_id,
      })
      if (!invoiceNumData) {
        return NextResponse.json(
          {
            success: false,
            error: "Failed to generate invoice number. Cannot create sent invoice without invoice number.",
            code: "GENERATE_NUMBER_FAILED",
          },
          { status: 500 }
        )
      }
      finalInvoiceNumber = invoiceNumData
    }

    // Prepare invoice data (using same canonical pattern as /api/invoices/create)
    // Persist canonical tax values directly from TaxResult
    const invoiceData: any = {
      business_id: order.business_id,
      customer_id: order.customer_id || null,
      invoice_number: finalInvoiceNumber,
      issue_date: invoiceIssueDate,
      due_date: finalDueDate || null,
      payment_terms: finalPaymentTerms,
      notes: orderReferenceNote,
      footer_message: finalFooterMessage,
      currency_code: businessCurrencyCode,
      currency_symbol: businessCurrencySymbol,
      // Canonical tax values from TaxResult (already rounded to 2dp)
      subtotal: baseSubtotal, // result.base_amount
      total_tax: taxResult ? Math.round(taxResult.total_tax * 100) / 100 : 0, // result.total_tax
      total: invoiceTotal, // result.total_amount
      apply_taxes: applyTaxes,
      status: "draft",
      public_token: publicToken,
      // Canonical tax_lines JSONB (source of truth)
      tax_lines: taxResult ? toTaxLinesJsonb(taxResult) : null,
      tax_engine_code: applyTaxes ? taxEngineCode : null,
      tax_engine_effective_from: applyTaxes ? effectiveDate : null, // Invoice date (not order date)
      tax_jurisdiction: applyTaxes ? jurisdiction : null,
      // Legacy columns derived from tax_lines (no Ghana-specific logic)
      nhil: applyTaxes ? Math.round(legacyTaxColumns.nhil * 100) / 100 : 0,
      getfund: applyTaxes ? Math.round(legacyTaxColumns.getfund * 100) / 100 : 0,
      covid: applyTaxes ? Math.round(legacyTaxColumns.covid * 100) / 100 : 0,
      vat: applyTaxes ? Math.round(legacyTaxColumns.vat * 100) / 100 : 0,
      // Only include source_type and source_id if columns exist (migration 077 may not be applied)
      // These fields are optional and won't break if the columns don't exist
    }
    
    // If status is "sent", set sent_at timestamp (this is the tax effective date)
    // Note: For order conversions, we default to draft, but allow explicit status
    if (invoiceStatus === "sent") {
      invoiceData.status = "sent"
      invoiceData.sent_at = new Date().toISOString()
      // Update effective date to sent_at date
      const sentAtDate = new Date().toISOString().split("T")[0]
      invoiceData.tax_engine_effective_from = applyTaxes ? sentAtDate : null
    } else {
      invoiceData.status = invoiceStatus
    }
    
    // Try to add source tracking fields (only if columns exist in schema)
    // We'll attempt to include them, but if they fail, we'll retry without them
    const invoiceDataWithSource = {
      ...invoiceData,
      source_type: "order",
      source_id: orderId,
    }

    // Log invoice data for debugging (without sensitive info)
    console.log("📝 Creating invoice with data:", {
      business_id: invoiceData.business_id,
      customer_id: invoiceData.customer_id,
      currency_code: invoiceData.currency_code,
      subtotal: invoiceData.subtotal,
      total: invoiceData.total,
      status: invoiceData.status,
      source_type: invoiceDataWithSource.source_type,
      source_id: invoiceDataWithSource.source_id,
    })

    // Create invoice - try with source tracking first, fallback without if columns don't exist
    let invoice
    let invoiceError
    
    // First attempt: try with source_type and source_id
    let result = await supabase
      .from("invoices")
      .insert(invoiceDataWithSource)
      .select()
      .single()
    
    invoice = result.data
    invoiceError = result.error
    
    // If error is about missing source_id/source_type columns, retry without them
    // Check for PGRST204 error code or error message mentioning source_id/source_type
    if (invoiceError) {
      const errorMessage = invoiceError.message || ""
      const errorCode = invoiceError.code || ""
      
      console.log("🔍 Invoice creation error detected:", {
        code: errorCode,
        message: errorMessage,
        details: invoiceError.details,
        hint: invoiceError.hint,
      })
      
      // Check if this is a schema-related error (missing columns)
      const isSchemaError = (
        errorCode === "PGRST204" || 
        errorMessage.toLowerCase().includes("source_id") || 
        errorMessage.toLowerCase().includes("source_type") ||
        errorMessage.toLowerCase().includes("schema cache") ||
        errorMessage.toLowerCase().includes("column") && errorMessage.toLowerCase().includes("not found")
      )
      
      if (isSchemaError) {
        console.log("⚠️ Schema error detected - source_id/source_type columns not found, retrying without source tracking fields")
        result = await supabase
          .from("invoices")
          .insert(invoiceData)
          .select()
          .single()
        
        invoice = result.data
        invoiceError = result.error
        
        if (!invoiceError) {
          console.log("✅ Invoice created successfully without source tracking fields")
        } else {
          console.error("❌ Retry also failed:", invoiceError)
        }
      }
    }

    if (invoiceError) {
      console.error("❌ Error creating invoice from order:", {
        error: invoiceError,
        code: invoiceError.code,
        message: invoiceError.message,
        details: invoiceError.details,
        hint: invoiceError.hint,
        invoiceData: JSON.stringify(invoiceData, null, 2),
      })
      
      // Provide more specific error messages based on error code
      let errorMessage = "Invoice could not be created from order"
      if (invoiceError.code === "23505") { // Unique constraint violation
        errorMessage = "Invoice with this identifier already exists. Please try again."
      } else if (invoiceError.code === "23503") { // Foreign key violation
        errorMessage = "Invalid business or customer reference. Please verify your data."
      } else if (invoiceError.code === "23502") { // Not null violation
        errorMessage = `Missing required field: ${invoiceError.message}`
      } else if (invoiceError.code === "PGRST204") { // Column not found
        errorMessage = `Database schema mismatch: ${invoiceError.message}. Please run database migrations.`
      } else if (invoiceError.message) {
        errorMessage = invoiceError.message
      }
      
      return NextResponse.json(
        {
          success: false,
          error: errorMessage,
          message: invoiceError.message || "Database error occurred",
          code: invoiceError.code,
          details: invoiceError.details,
        },
        { status: 500 }
      )
    }

    // Create invoice items
    const invoiceItemsData = invoiceItems.map((item: any) => ({
      invoice_id: invoice.id,
      product_service_id: item.product_service_id || null,
      description: item.description || "",
      qty: item.qty,
      unit_price: item.unit_price,
      discount_amount: item.discount_amount || 0,
      line_subtotal: item.line_subtotal,
    }))

    const { data: insertedItems, error: invoiceItemsError } = await supabase
      .from("invoice_items")
      .insert(invoiceItemsData)
      .select()

    if (invoiceItemsError) {
      console.error("❌ Error creating invoice items:", invoiceItemsError)
      // Delete the invoice if items fail
      await supabase.from("invoices").delete().eq("id", invoice.id)
      return NextResponse.json(
        {
          success: false,
          error: "Invoice items could not be saved",
          message: invoiceItemsError.message,
        },
        { status: 500 }
      )
    }
    
    console.log("✅ Invoice items successfully inserted:", JSON.stringify(insertedItems, null, 2))

    // Update order: link to invoice and set status to 'converted' (schema allows draft|issued|converted|cancelled)
    const { error: orderUpdateError } = await supabase
      .from("orders")
      .update({
        invoice_id: invoice.id,
        status: "converted",
      })
      .eq("id", orderId)

    if (orderUpdateError) {
      console.error("Error updating order with invoice link:", orderUpdateError)
      // Note: Invoice is already created, so we log but don't fail
    }

    // Log audit entries (wrap in try-catch to prevent failures from breaking the request)
    try {
      await createAuditLog({
        businessId: order.business_id,
        userId: user?.id || null,
        actionType: "invoice.created",
        entityType: "invoice",
        entityId: invoice.id,
        oldValues: null,
        newValues: invoice,
        request,
        description: `Invoice created from order ${orderId}`,
      })
    } catch (auditError) {
      console.error("Failed to create audit log for invoice creation:", auditError)
      // Continue execution - audit log failure should not break the conversion
    }

    try {
      await createAuditLog({
        businessId: order.business_id,
        userId: user?.id || null,
        actionType: "order.converted_to_invoice",
        entityType: "order",
        entityId: orderId,
        oldValues: { status: order.status, invoice_id: null },
        newValues: { status: "converted", invoice_id: invoice.id },
        request,
        description: `Order converted to invoice ${invoice.invoice_number || invoice.id}`,
      })
    } catch (auditError) {
      console.error("Failed to create audit log for order conversion:", auditError)
      // Continue execution - audit log failure should not break the conversion
    }

    // Return success response with invoice and order info
    return NextResponse.json({
      success: true,
      invoiceId: invoice.id,
      invoice: invoice,
      orderId: orderId,
      order: {
        id: order.id,
        status: "converted",
        invoice_id: invoice.id,
      },
      invoiceUrl: `/invoices/${invoice.id}/view`,
      message: "Order converted to invoice successfully",
    })
  } catch (error: any) {
    console.error("Error converting order to invoice:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Order could not be converted to invoice",
        message: error.message || "Internal server error",
      },
      { status: 500 }
    )
  }
}

