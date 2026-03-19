import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { getTaxEngineCode, deriveLegacyTaxColumnsFromTaxLines, getCanonicalTaxResultFromLineItems } from "@/lib/taxEngine/helpers"
import { toTaxLinesJsonb } from "@/lib/taxEngine/serialize"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { getCurrencySymbol } from "@/lib/currency"
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

    const body = await request.json()
    const {
      customer_id,
      estimate_number,
      issue_date,
      expiry_date,
      notes,
      items,
      apply_taxes = true,
      currency_code, // FX currency for this document (e.g. "USD"). Defaults to business home currency.
      fx_rate,       // Exchange rate: 1 unit of currency_code = fx_rate units of home currency
    } = body

    // Validate required fields
    if (!issue_date || !items || items.length === 0) {
      return NextResponse.json(
        { 
          success: false,
          error: "Missing required fields: issue_date and items are required",
          message: "Invalid request"
        },
        { status: 400 }
      )
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }
    const businessId = business.id

    // Generate quote number (QUO-XXXX) if not provided. Existing EST- records unchanged.
    const QUOTE_PREFIX = "QUO-"
    let finalEstimateNumber = estimate_number
    if (!finalEstimateNumber) {
      const { data: lastQuote } = await supabase
        .from("estimates")
        .select("estimate_number")
        .eq("business_id", businessId)
        .like("estimate_number", `${QUOTE_PREFIX}%`)
        .is("deleted_at", null)
        .order("estimate_number", { ascending: false })
        .limit(1)
        .maybeSingle()
      const lastNum = lastQuote?.estimate_number
        ? parseInt(lastQuote.estimate_number.replace(QUOTE_PREFIX, ""), 10) || 0
        : 0
      finalEstimateNumber = `${QUOTE_PREFIX}${String(lastNum + 1).padStart(4, "0")}`
    }

    // Get business country for tax jurisdiction
    // CRITICAL: Fetch country - required for tax calculation
    const { data: businessData } = await supabase
      .from("businesses")
      .select("address_country, default_currency")
      .eq("id", businessId)
      .single()

    // BLOCK estimate creation if business country is missing (no silent fallback)
    if (!businessData?.address_country) {
      return NextResponse.json(
        {
          success: false,
          error: "Business country is required. Please set your business country in Business Profile settings.",
          message: "Country required for tax calculation"
        },
        { status: 400 }
      )
    }

    // Resolve FX fields
    const homeCurrencyCode = businessData.default_currency || null
    const estimateCurrencyCode = currency_code || homeCurrencyCode
    const isFxEstimate = !!(estimateCurrencyCode && homeCurrencyCode &&
      estimateCurrencyCode.toUpperCase() !== homeCurrencyCode.toUpperCase())
    const parsedFxRate = fx_rate ? Number(fx_rate) : null
    if (isFxEstimate && (!parsedFxRate || parsedFxRate <= 0)) {
      return NextResponse.json(
        {
          success: false,
          error: `Exchange rate is required when quoting in ${estimateCurrencyCode}. Please provide the rate (e.g. 1 ${estimateCurrencyCode} = X ${homeCurrencyCode}).`,
          message: "FX rate required for foreign currency quote",
        },
        { status: 400 }
      )
    }
    const estimateCurrencySymbol = getCurrencySymbol(estimateCurrencyCode || "")

    // Prepare line items for tax calculation
    const lineItems = items.map((item: any) => ({
      quantity: Number(item.qty || item.quantity) || 0,
      unit_price: Number(item.unit_price || item.price) || 0,
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

    // Estimates are non-financial; taxes are recomputed on invoice conversion.
    // Effective date: Use estimate issue_date for tax calculation
    const effectiveDate = issue_date || new Date().toISOString().split('T')[0]

    // Calculate taxes using canonical tax engine (tax-inclusive mode)
    const jurisdiction = normalizeCountry(businessData.address_country)
    if (!jurisdiction) {
      return NextResponse.json({ success: false, error: "Jurisdiction required", message: "Business country could not be resolved for tax calculation." }, { status: 400 })
    }
    const taxEngineCode = getTaxEngineCode(jurisdiction)
    let taxResult: import('@/lib/taxEngine/types').TaxResult | null = null
    let baseSubtotal: number
    let estimateTotal: number
    let legacyTaxColumns: { nhil: number; getfund: number; covid: number; vat: number }
    
    if (apply_taxes) {
      // Use canonical tax engine
      const config: TaxEngineConfig = {
        jurisdiction,
        effectiveDate,
        taxInclusive: true, // Estimates use tax-inclusive pricing (like invoices)
      }
      
      taxResult = getCanonicalTaxResultFromLineItems(lineItems, config)
      
      // Persist canonical values (rounded to 2dp)
      baseSubtotal = Math.round(taxResult.base_amount * 100) / 100
      estimateTotal = Math.round(taxResult.total_amount * 100) / 100
      
      // Derive legacy columns from canonical tax lines (no rate logic, no cutoff logic, no country branching)
      legacyTaxColumns = deriveLegacyTaxColumnsFromTaxLines(taxResult.lines)
    } else {
      // No taxes applied
      const subtotal = lineItems.reduce((sum: number, item: any) => {
        const lineTotal = item.quantity * item.unit_price
        const discount = item.discount_amount || 0
        return sum + lineTotal - discount
      }, 0)
      
      baseSubtotal = Math.round(subtotal * 100) / 100
      estimateTotal = Math.round(subtotal * 100) / 100
      legacyTaxColumns = { nhil: 0, getfund: 0, covid: 0, vat: 0 }
    }
    
    // Validate calculated values
    if (isNaN(baseSubtotal) || baseSubtotal < 0 || isNaN(estimateTotal) || estimateTotal < 0) {
      console.error("Invalid tax calculation:", { baseSubtotal, estimateTotal, taxResult })
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

    // Create estimate
    // Estimates are non-financial; taxes are recomputed on invoice conversion.
    const { data: estimate, error: estimateError } = await supabase
      .from("estimates")
      .insert({
        business_id: businessId,
        customer_id: customer_id || null,
        estimate_number: finalEstimateNumber,
        issue_date,
        expiry_date: expiry_date || null,
        notes: notes || null,
        currency_code: estimateCurrencyCode || null,
        currency_symbol: estimateCurrencySymbol || null,
        fx_rate: isFxEstimate ? parsedFxRate : null,
        home_currency_code: isFxEstimate ? homeCurrencyCode : null,
        home_currency_total: isFxEstimate && parsedFxRate
          ? Math.round(estimateTotal * parsedFxRate * 100) / 100
          : null,
        // Canonical tax values from TaxResult (already rounded to 2dp)
        subtotal: baseSubtotal, // result.base_amount
        total_tax_amount: taxResult ? Math.round(taxResult.total_tax * 100) / 100 : 0, // result.total_tax
        total_amount: estimateTotal, // result.total_amount
        // Legacy columns derived from tax_lines (no rate logic, no cutoff logic, no country branching)
        subtotal_before_tax: baseSubtotal,
        nhil_amount: Math.round(legacyTaxColumns.nhil * 100) / 100,
        getfund_amount: Math.round(legacyTaxColumns.getfund * 100) / 100,
        covid_amount: Math.round(legacyTaxColumns.covid * 100) / 100,
        vat_amount: Math.round(legacyTaxColumns.vat * 100) / 100,
        tax: taxResult ? Math.round(taxResult.total_tax * 100) / 100 : 0,
        status: "draft",
        // Canonical tax_lines JSONB (source of truth)
        tax_lines: taxResult ? toTaxLinesJsonb(taxResult) : null,
        tax_engine_code: apply_taxes ? taxEngineCode : null,
        tax_engine_effective_from: apply_taxes ? effectiveDate : null, // Use estimate issue_date
        tax_jurisdiction: apply_taxes ? jurisdiction : null,
      })
      .select()
      .single()

    if (estimateError) {
      console.error("Error creating estimate:", estimateError)
      return NextResponse.json(
        { 
          success: false,
          error: estimateError.message || "Failed to create estimate",
          message: "Database error"
        },
        { status: 500 }
      )
    }

    if (!estimate) {
      return NextResponse.json(
        { 
          success: false,
          error: "Failed to create estimate - no data returned",
          message: "Creation failed"
        },
        { status: 500 }
      )
    }

    // Create estimate items
    // IMPORTANT: product_id references products(id), but we're using products_services
    // So we MUST use product_service_id (references products_services(id)) instead
    // Set product_id to null to avoid foreign key constraint violation
    const estimateItems = items.map((item: any) => {
      const qty = Number(item.qty || item.quantity) || 0
      const price = Number(item.unit_price || item.price) || 0
      const total = qty * price
      
      // Get product_service_id from the item (from products_services table)
      const productServiceId = item.product_id || item.product_service_id || null
      
      // Build item object - only include columns that definitely exist in all schema versions
      // Based on migrations, the guaranteed columns are:
      // - estimate_id, description, quantity, price, total, created_at
      // DO NOT include product_service_id or product_id - they may not exist or may reference wrong table
      const itemData: any = {
        estimate_id: estimate.id,
        description: item.description || "",
        quantity: qty,
        price: price,
        total: total,
      }
      
      // Note: product_id and product_service_id columns will remain NULL
      // This is acceptable since they're nullable foreign keys
      // We can't reliably use them because:
      // 1. product_id references products(id) but we're using products_services
      // 2. product_service_id may not exist in all schema versions
      
      return itemData
    })

    console.log("Inserting estimate items:", JSON.stringify(estimateItems, null, 2))
    console.log("Estimate ID:", estimate.id)
    console.log("Number of items to insert:", estimateItems.length)

    const { data: insertedItems, error: itemsError } = await supabase
      .from("estimate_items")
      .insert(estimateItems)
      .select()

    if (itemsError) {
      console.error("Error creating estimate items:", itemsError)
      console.error("Error details:", {
        message: itemsError.message,
        code: itemsError.code,
        details: itemsError.details,
        hint: itemsError.hint
      })
      // Delete the estimate if items fail
      await supabase.from("estimates").delete().eq("id", estimate.id)
      return NextResponse.json(
        { 
          success: false,
          error: itemsError.message || "Failed to create estimate items",
          message: "Items creation failed",
          details: itemsError
        },
        { status: 500 }
      )
    }

    console.log("Successfully inserted estimate items:", JSON.stringify(insertedItems, null, 2))
    console.log("Number of items inserted:", insertedItems?.length || 0)

    return NextResponse.json({ 
      success: true,
      estimateId: estimate.id,
      estimate 
    }, { status: 201 })
  } catch (error: any) {
    console.error("Error in estimate creation:", error)
    return NextResponse.json(
      { 
        success: false,
        error: error.message || "Internal server error",
        message: "Unexpected error"
      },
      { status: 500 }
    )
  }
}

