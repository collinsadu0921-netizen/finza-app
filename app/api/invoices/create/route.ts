import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { getTaxEngineCode, deriveLegacyTaxColumnsFromTaxLines, getCanonicalTaxResultFromLineItems } from "@/lib/taxEngine/helpers"
import { toTaxLinesJsonb } from "@/lib/taxEngine/serialize"
import { createAuditLog } from "@/lib/auditLog"
import { assertBusinessNotArchived } from "@/lib/archivedBusiness"
import { getCurrencySymbol } from "@/lib/currency"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { assertCountryCurrency } from "@/lib/countryCurrency"
import type { TaxEngineConfig } from "@/lib/taxEngine/types"

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
      return NextResponse.json(
        { error: "Business not found. Please ensure you have a business set up." },
        { status: 404 }
      )
    }

    const body = await request.json()
    const {
      customer_id,
      invoice_number,
      issue_date,
      due_date,
      payment_terms,
      notes,
      footer_message,
      items,
      apply_taxes = true,
      currency_code, // No default - must come from business
      currency_symbol, // No default - must come from business
      status = "draft", // Allow status to be passed (defaults to draft)
    } = body

    // Validate required fields (business comes from session)
    if (!issue_date || !items || items.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    const business_id = business.id

    // Invoice number is system-controlled: only assign when status is "sent"
    // For draft invoices, invoice_number will be null until the invoice is issued
    let finalInvoiceNumber: string | null = null
    
    // Only generate invoice number if status is "sent" (invoice is being issued)
    // Reject any manually provided invoice_number to enforce system control
    if (invoice_number) {
      console.warn("Manual invoice_number provided but ignored - invoice numbers are system-controlled")
    }
    
    if (status === "sent") {
      // Generate invoice number when invoice is issued
      const { data: invoiceNumData } = await supabase.rpc("generate_invoice_number_with_settings", {
        business_uuid: business_id,
      })
      finalInvoiceNumber = invoiceNumData || null
      if (!finalInvoiceNumber) {
        return NextResponse.json(
          { error: "Failed to generate invoice number. Please try again." },
          { status: 500 }
        )
      }
    }

    // Get business profile for currency/country (session business already resolved)
    const { data: businessProfile } = await supabase
      .from("businesses")
      .select("address_country, default_currency")
      .eq("id", business_id)
      .single()

    try {
      await assertBusinessNotArchived(supabase, business_id)
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "Business is archived" },
        { status: 403 }
      )
    }

    // BLOCK invoice creation if business country is missing (no silent fallback)
    if (!businessProfile?.address_country) {
      return NextResponse.json(
        { 
          success: false,
          error: "Business country is required. Please set your business country in Business Profile settings.",
          message: "Country required for tax calculation"
        },
        { status: 400 }
      )
    }

    // Get currency from business settings (no hard-coded defaults)
    // Currency must be explicitly set in business profile
    const businessCurrencyCode = currency_code || businessProfile?.default_currency
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
    const countryCode = normalizeCountry(businessProfile!.address_country)
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
    const businessCurrencySymbol = currency_symbol || getCurrencySymbol(businessCurrencyCode)
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

    const { data: invoiceSettings } = await supabase
      .from("invoice_settings")
      .select("*")
      .eq("business_id", business_id)
      .maybeSingle()

    // Calculate due date if not provided
    let finalDueDate = due_date
    if (!finalDueDate && issue_date && invoiceSettings?.due_days_default) {
      const issueDate = new Date(issue_date)
      issueDate.setDate(issueDate.getDate() + invoiceSettings.due_days_default)
      finalDueDate = issueDate.toISOString().split("T")[0]
    }

    // Use default payment terms and footer if not provided
    const finalPaymentTerms = payment_terms || invoiceSettings?.default_payment_terms || null
    const finalFooterMessage = footer_message || invoiceSettings?.default_footer_message || null

    // Prepare line items for tax calculation
    const lineItems = items.map((item: any) => ({
      quantity: Number(item.qty) || 0,
      unit_price: Number(item.unit_price) || 0,
      discount_amount: Number(item.discount_amount) || 0,
    }))

    // Validate line items
    for (const item of lineItems) {
      if (isNaN(item.quantity) || item.quantity < 0 || 
          isNaN(item.unit_price) || item.unit_price < 0 || 
          isNaN(item.discount_amount) || item.discount_amount < 0) {
        console.error("Invalid line item values:", item)
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

    // Determine effective date: Draft uses issue_date, Sent uses sent_at (current date)
    // Note: effectiveDate should be YYYY-MM-DD format for tax engine
    const effectiveDateForCalculation = status === "sent" 
      ? new Date().toISOString().split('T')[0]
      : (issue_date || new Date().toISOString().split('T')[0])

    // Calculate taxes using canonical tax engine (tax-inclusive mode)
    const jurisdiction = countryCode // Already validated - cannot be null
    const taxEngineCode = getTaxEngineCode(jurisdiction)
    let taxResult: import('@/lib/taxEngine/types').TaxResult | null = null
    let baseSubtotal: number
    let invoiceTotal: number
    let legacyTaxColumns: { nhil: number; getfund: number; covid: number; vat: number }
    
    if (apply_taxes) {
      // Use canonical tax engine
      const config: TaxEngineConfig = {
        jurisdiction,
        effectiveDate: effectiveDateForCalculation,
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

    // Generate public token
    let publicToken: string
    try {
      const { data: tokenData } = await supabase.rpc("generate_public_token")
      publicToken = tokenData || Buffer.from(`${business_id}-${Date.now()}`).toString("base64url")
    } catch (tokenError) {
      // Fallback if RPC function doesn't exist
      publicToken = Buffer.from(`${business_id}-${Date.now()}`).toString("base64url")
    }

    // Prepare invoice data with validated numeric values
    // Persist canonical tax values directly from TaxResult
    const invoiceData: any = {
      business_id,
      customer_id: customer_id || null,
      invoice_number: finalInvoiceNumber,
      issue_date,
      due_date: finalDueDate || null,
      payment_terms: finalPaymentTerms,
      notes: notes || null,
      footer_message: finalFooterMessage,
      currency_code: businessCurrencyCode,
      currency_symbol: businessCurrencySymbol,
      // Canonical tax values from TaxResult (already rounded to 2dp)
      subtotal: baseSubtotal, // result.base_amount
      total_tax: taxResult ? Math.round(taxResult.total_tax * 100) / 100 : 0, // result.total_tax
      total: invoiceTotal, // result.total_amount
      apply_taxes,
      status: status || "draft",
      public_token: publicToken,
      // Canonical tax_lines JSONB (source of truth)
      tax_lines: taxResult ? toTaxLinesJsonb(taxResult) : null,
      tax_engine_code: apply_taxes ? taxEngineCode : null,
      tax_engine_effective_from: apply_taxes ? effectiveDateForCalculation : null, // issue_date for drafts, sent_at date for sent
      tax_jurisdiction: apply_taxes ? jurisdiction : null,
      // Legacy columns derived from tax_lines (no Ghana-specific logic)
      nhil: apply_taxes ? Math.round(legacyTaxColumns.nhil * 100) / 100 : 0,
      getfund: apply_taxes ? Math.round(legacyTaxColumns.getfund * 100) / 100 : 0,
      covid: apply_taxes ? Math.round(legacyTaxColumns.covid * 100) / 100 : 0,
      vat: apply_taxes ? Math.round(legacyTaxColumns.vat * 100) / 100 : 0,
    }

    // If status is "sent", set sent_at timestamp (this is the tax effective date)
    if (status === "sent") {
      invoiceData.sent_at = new Date().toISOString()
      // tax_engine_effective_from is already set to effectiveDateForCalculation (sent_at date when status is "sent")
    }

    // Create invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .insert(invoiceData)
      .select()
      .single()

    if (invoiceError) {
      console.error("Error creating invoice:", invoiceError)
      console.error("Invoice data attempted:", JSON.stringify(invoiceData, null, 2))
      
      // Extract error information safely
      const errorInfo = {
        message: invoiceError.message || "Unknown database error",
        code: invoiceError.code || null,
        details: invoiceError.details || null,
        hint: invoiceError.hint || null,
      }
      
      console.error("Error details:", errorInfo)
      
      // Check for specific error types and provide user-friendly messages
      let userFriendlyError = "Invoice could not be saved. Please check all fields and try again."
      let userFriendlyMessage = errorInfo.message

      // Handle duplicate invoice number error
      if (errorInfo.code === "23505" && errorInfo.message?.includes("idx_invoices_business_invoice_number")) {
        userFriendlyError = "This invoice number already exists. Please use a different invoice number."
        userFriendlyMessage = `Invoice number "${invoiceData.invoice_number}" is already in use for this business. Please choose a different number.`
      }

      // Handle period-lock errors from accounting period trigger
      const msg = errorInfo.message ?? ""
      if (
        msg.includes("Accounting period is locked") ||
        msg.includes("Accounting period is soft-closed") ||
        msg.includes("period is locked") ||
        msg.includes("period is soft-closed") ||
        msg.includes("Cannot post") ||
        msg.includes("period is closed")
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "This accounting period is locked or closed. Please open the period before creating invoices.",
            message: msg,
            code: "PERIOD_CLOSED",
          },
          { status: 400 }
        )
      }
      
      // Build response with all available error information
      const errorResponse: any = {
        success: false,
        error: userFriendlyError,
        message: userFriendlyMessage,
      }
      
      // Add optional fields only if they exist
      if (errorInfo.code) errorResponse.code = errorInfo.code
      if (errorInfo.details) errorResponse.details = errorInfo.details
      if (errorInfo.hint) errorResponse.hint = errorInfo.hint
      
      // In development, include additional debugging info
      if (process.env.NODE_ENV === "development") {
        errorResponse.debug = {
          errorObject: {
            message: invoiceError.message,
            code: invoiceError.code,
            details: invoiceError.details,
            hint: invoiceError.hint,
          },
          invoiceData: invoiceData
        }
      }
      
      console.error("Returning error response to client:", JSON.stringify(errorResponse, null, 2))
      return NextResponse.json(errorResponse, { status: 500 })
    }

    // Create invoice items
    // product_service_id must reference products_services(id); if the client sent a product_id from
    // the products table (or an invalid id), set to null to avoid FK violation.
    const candidateIds = [
      ...new Set(
        items
          .map((item: any) => item.product_service_id || item.product_id)
          .filter(Boolean)
      ),
    ] as string[]
    let validProductServiceIds: Set<string> = new Set()
    if (candidateIds.length > 0) {
      const { data: validRows } = await supabase
        .from("products_services")
        .select("id")
        .in("id", candidateIds)
      if (validRows?.length) {
        validProductServiceIds = new Set(validRows.map((r) => r.id))
      }
    }

    const invoiceItems = items.map((item: any) => {
      const rawId = item.product_service_id || item.product_id || null
      const product_service_id =
        rawId && validProductServiceIds.has(rawId) ? rawId : null
      return {
        invoice_id: invoice.id,
        product_service_id,
        description: item.description || "",
        qty: Number(item.qty) || 0,
        unit_price: Number(item.unit_price) || 0,
        discount_amount: Number(item.discount_amount) || 0,
        line_subtotal: (Number(item.qty) || 0) * (Number(item.unit_price) || 0) - (Number(item.discount_amount) || 0),
      }
    })

    const { error: itemsError } = await supabase
      .from("invoice_items")
      .insert(invoiceItems)

    if (itemsError) {
      console.error("Error creating invoice items:", itemsError)
      // Delete the invoice if items fail
      await supabase.from("invoices").delete().eq("id", invoice.id)
      return NextResponse.json(
        { 
          success: false,
          error: "Invoice items could not be saved. Please check all item fields and try again.",
          message: itemsError.message
        },
        { status: 500 }
      )
    }

    // Log audit entry
    await createAuditLog({
      businessId: business_id,
      userId: user?.id || null,
      actionType: "invoice.created",
      entityType: "invoice",
      entityId: invoice.id,
      oldValues: null,
      newValues: invoice,
      request,
    })

    // Return success response with invoice ID and full invoice object
    return NextResponse.json(
      {
        success: true,
        invoiceId: invoice.id,
        invoice: invoice,
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error("Error in invoice creation:", error)
    console.error("Error stack:", error.stack)
    console.error("Error details:", {
      message: error.message,
      name: error.name,
      cause: error.cause,
      toString: error.toString(),
    })
    
    // Safely extract error message
    const errorMessage = error?.message || error?.toString() || "Internal server error"
    
    // Build error response object
    const errorResponse: any = {
      success: false,
      error: "Invoice could not be created. Please check all fields and try again.",
      message: errorMessage,
    }
    
    // Add development details
    if (process.env.NODE_ENV === "development") {
      errorResponse.debug = {
        errorMessage: errorMessage,
        errorType: error?.name || typeof error,
        errorString: error?.toString() || String(error),
        stack: error?.stack?.split("\n").slice(0, 10).join("\n") || null,
      }
    }
    
    console.error("Returning error response:", JSON.stringify(errorResponse, null, 2))
    
    try {
      return NextResponse.json(errorResponse, { status: 500 })
    } catch (responseError: any) {
      console.error("CRITICAL: Failed to create error response:", responseError)
      // Fallback: return a simple text response
      return new NextResponse(
        JSON.stringify({
          success: false,
          error: "Invoice could not be created",
          message: errorMessage
        }),
        { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      )
    }
  }
}
