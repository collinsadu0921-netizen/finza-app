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
      issue_date,
      validity_date,
      payment_terms,
      notes,
      footer_message,
      apply_taxes = true,
      status = "draft",
      source_estimate_id,
      items,
      currency_code, // FX currency for this document (e.g. "USD"). Defaults to business home currency.
      fx_rate,       // Exchange rate: 1 unit of currency_code = fx_rate units of home currency
    } = body

    // Validate required fields
    if (!issue_date || !items || items.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    const business_id = business.id

    // Get business profile for currency/country
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

    // Block proforma creation if business country is missing
    if (!businessProfile?.address_country) {
      return NextResponse.json(
        {
          success: false,
          error: "Business country is required. Please set your business country in Business Profile settings.",
          message: "Country required for tax calculation",
        },
        { status: 400 }
      )
    }

    // Validate home currency (business.default_currency) against country — always required
    const homeCurrencyCode = businessProfile?.default_currency
    if (!homeCurrencyCode) {
      return NextResponse.json(
        {
          success: false,
          error: "Business currency is required. Please set your default currency in Business Profile settings.",
          message: "Currency required for proforma creation",
        },
        { status: 400 }
      )
    }

    const countryCode = normalizeCountry(businessProfile!.address_country)
    try {
      assertCountryCurrency(countryCode, homeCurrencyCode)
    } catch (error: any) {
      return NextResponse.json(
        {
          success: false,
          error: error.message || "Currency does not match business country.",
          message: error.message || "Currency-country mismatch",
        },
        { status: 400 }
      )
    }

    // Proforma currency: may be a foreign currency (FX) or the home currency
    const proformaCurrencyCode = currency_code || homeCurrencyCode
    const isFxProforma = proformaCurrencyCode.toUpperCase() !== homeCurrencyCode.toUpperCase()
    const parsedFxRate = fx_rate ? Number(fx_rate) : null

    if (isFxProforma && (!parsedFxRate || parsedFxRate <= 0)) {
      return NextResponse.json(
        {
          success: false,
          error: `Exchange rate is required when issuing a proforma in ${proformaCurrencyCode}. Please provide the rate (e.g. 1 ${proformaCurrencyCode} = X ${homeCurrencyCode}).`,
          message: "FX rate required for foreign currency proforma",
        },
        { status: 400 }
      )
    }

    // Map currency code to symbol
    const businessCurrencyCode = proformaCurrencyCode
    const businessCurrencySymbol = getCurrencySymbol(proformaCurrencyCode)
    if (!businessCurrencySymbol) {
      return NextResponse.json(
        {
          success: false,
          error: "Currency symbol could not be determined. Please verify your currency code is valid.",
          message: "Invalid currency code",
        },
        { status: 400 }
      )
    }

    // Generate proforma number if status is 'sent'
    let finalProformaNumber: string | null = null
    let sentAt: string | null = null

    if (status === "sent") {
      const { data: proformaNumData } = await supabase.rpc("generate_proforma_number", {
        p_business_id: business_id,
      })
      finalProformaNumber = proformaNumData || null
      if (!finalProformaNumber) {
        return NextResponse.json(
          { error: "Failed to generate proforma number. Please try again." },
          { status: 500 }
        )
      }
      sentAt = new Date().toISOString()
    }

    // Prepare line items for tax calculation
    const lineItems = items.map((item: any) => ({
      quantity: Number(item.qty) || 0,
      unit_price: Number(item.unit_price) || 0,
      discount_amount: Number(item.discount_amount) || 0,
    }))

    // Validate line items
    for (const item of lineItems) {
      if (
        isNaN(item.quantity) || item.quantity < 0 ||
        isNaN(item.unit_price) || item.unit_price < 0 ||
        isNaN(item.discount_amount) || item.discount_amount < 0
      ) {
        console.error("Invalid line item values:", item)
        return NextResponse.json(
          {
            success: false,
            error: "Invalid line items. Please check quantities and prices.",
            message: "Line item validation failed",
          },
          { status: 400 }
        )
      }
    }

    // Determine effective date for tax calculation
    const effectiveDateForCalculation =
      status === "sent"
        ? new Date().toISOString().split("T")[0]
        : issue_date || new Date().toISOString().split("T")[0]

    const jurisdiction = countryCode
    if (!jurisdiction) {
      return NextResponse.json(
        { error: "Jurisdiction required", message: "Business country could not be resolved for tax calculation." },
        { status: 400 }
      )
    }
    const taxEngineCode = getTaxEngineCode(jurisdiction)

    let taxResult: import("@/lib/taxEngine/types").TaxResult | null = null
    let baseSubtotal: number
    let proformaTotal: number
    let legacyTaxColumns: { nhil: number; getfund: number; covid: number; vat: number }

    if (apply_taxes) {
      const config: TaxEngineConfig = {
        jurisdiction,
        effectiveDate: effectiveDateForCalculation,
        taxInclusive: true,
      }

      taxResult = getCanonicalTaxResultFromLineItems(lineItems, config)

      baseSubtotal = Math.round(taxResult.base_amount * 100) / 100
      proformaTotal = Math.round(taxResult.total_amount * 100) / 100

      legacyTaxColumns = deriveLegacyTaxColumnsFromTaxLines(taxResult.lines)
    } else {
      const subtotal = lineItems.reduce((sum: number, item: any) => {
        const lineTotal = item.quantity * item.unit_price
        const discount = item.discount_amount || 0
        return sum + Math.round((lineTotal - discount) * 100) / 100
      }, 0)

      baseSubtotal = Math.round(subtotal * 100) / 100
      proformaTotal = Math.round(subtotal * 100) / 100
      legacyTaxColumns = { nhil: 0, getfund: 0, covid: 0, vat: 0 }
    }

    // Validate calculated values
    if (isNaN(baseSubtotal) || baseSubtotal < 0 || isNaN(proformaTotal) || proformaTotal < 0) {
      console.error("Invalid tax calculation:", { baseSubtotal, proformaTotal, taxResult })
      return NextResponse.json(
        {
          success: false,
          error: "Invalid tax calculation. Please check line items and try again.",
          message: "Tax calculation error",
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
            message: "Tax calculation error",
          },
          { status: 400 }
        )
      }
    }

    // Prepare proforma data
    const proformaData: any = {
      business_id,
      customer_id: customer_id || null,
      proforma_number: finalProformaNumber,
      issue_date,
      validity_date: validity_date || null,
      payment_terms: payment_terms || null,
      notes: notes || null,
      footer_message: footer_message || null,
      currency_code: businessCurrencyCode,
      currency_symbol: businessCurrencySymbol,
      fx_rate: isFxProforma ? parsedFxRate : null,
      home_currency_code: isFxProforma ? homeCurrencyCode : null,
      home_currency_total: isFxProforma && parsedFxRate
        ? Math.round(proformaTotal * parsedFxRate * 100) / 100
        : null,
      subtotal: baseSubtotal,
      total_tax: taxResult ? Math.round(taxResult.total_tax * 100) / 100 : 0,
      total: proformaTotal,
      apply_taxes,
      status: status || "draft",
      source_estimate_id: source_estimate_id || null,
      tax_lines: taxResult ? toTaxLinesJsonb(taxResult) : null,
      tax_engine_code: apply_taxes ? taxEngineCode : null,
      tax_engine_effective_from: apply_taxes ? effectiveDateForCalculation : null,
      tax_jurisdiction: apply_taxes ? jurisdiction : null,
      nhil: apply_taxes ? Math.round(legacyTaxColumns.nhil * 100) / 100 : 0,
      getfund: apply_taxes ? Math.round(legacyTaxColumns.getfund * 100) / 100 : 0,
      covid: apply_taxes ? Math.round(legacyTaxColumns.covid * 100) / 100 : 0,
      vat: apply_taxes ? Math.round(legacyTaxColumns.vat * 100) / 100 : 0,
    }

    if (sentAt) {
      proformaData.sent_at = sentAt
    }

    // Insert proforma invoice
    const { data: proforma, error: proformaError } = await supabase
      .from("proforma_invoices")
      .insert(proformaData)
      .select()
      .single()

    if (proformaError) {
      console.error("Error creating proforma invoice:", proformaError)
      console.error("Proforma data attempted:", JSON.stringify(proformaData, null, 2))

      const errorInfo = {
        message: proformaError.message || "Unknown database error",
        code: proformaError.code || null,
        details: proformaError.details || null,
        hint: proformaError.hint || null,
      }

      let userFriendlyError = "Proforma invoice could not be saved. Please check all fields and try again."

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
            error: "This accounting period is locked or closed. Please open the period before creating proforma invoices.",
            message: msg,
            code: "PERIOD_CLOSED",
          },
          { status: 400 }
        )
      }

      const errorResponse: any = {
        success: false,
        error: userFriendlyError,
        message: errorInfo.message,
      }

      if (errorInfo.code) errorResponse.code = errorInfo.code
      if (errorInfo.details) errorResponse.details = errorInfo.details
      if (errorInfo.hint) errorResponse.hint = errorInfo.hint

      if (process.env.NODE_ENV === "development") {
        errorResponse.debug = { errorObject: errorInfo, proformaData }
      }

      return NextResponse.json(errorResponse, { status: 500 })
    }

    // Validate product_service_id references before inserting items
    const candidateIds = [
      ...new Set(
        items
          .map((item: any) => item.product_service_id)
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

    // Insert proforma invoice items
    const proformaItems = items.map((item: any) => {
      const rawId = item.product_service_id || null
      const product_service_id =
        rawId && validProductServiceIds.has(rawId) ? rawId : null
      return {
        proforma_invoice_id: proforma.id,
        product_service_id,
        description: item.description || "",
        qty: Number(item.qty) || 0,
        unit_price: Number(item.unit_price) || 0,
        discount_amount: Number(item.discount_amount) || 0,
        line_subtotal:
          Math.round(
            ((Number(item.qty) || 0) * (Number(item.unit_price) || 0) -
              (Number(item.discount_amount) || 0)) *
              100
          ) / 100,
      }
    })

    const { error: itemsError } = await supabase
      .from("proforma_invoice_items")
      .insert(proformaItems)

    if (itemsError) {
      console.error("Error creating proforma invoice items:", itemsError)
      // Delete the proforma if items fail
      await supabase.from("proforma_invoices").delete().eq("id", proforma.id)
      return NextResponse.json(
        {
          success: false,
          error: "Proforma invoice items could not be saved. Please check all item fields and try again.",
          message: itemsError.message,
        },
        { status: 500 }
      )
    }

    // If converting from an estimate, mark the estimate as converted
    if (source_estimate_id) {
      const { error: estimateUpdateError } = await supabase
        .from("estimates")
        .update({
          converted_to: "proforma",
          converted_to_proforma_id: proforma.id,
        })
        .eq("id", source_estimate_id)

      if (estimateUpdateError) {
        console.error("Error updating source estimate:", estimateUpdateError)
        // Non-fatal: proforma was created successfully
      }
    }

    // Log audit entry
    await createAuditLog({
      businessId: business_id,
      userId: user?.id || null,
      actionType: "proforma.created",
      entityType: "proforma_invoice",
      entityId: proforma.id,
      oldValues: null,
      newValues: proforma,
      request,
    })

    return NextResponse.json(
      {
        success: true,
        proformaId: proforma.id,
        proforma,
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error("Error in proforma invoice creation:", error)
    console.error("Error stack:", error.stack)

    const errorMessage = error?.message || error?.toString() || "Internal server error"

    const errorResponse: any = {
      success: false,
      error: "Proforma invoice could not be created. Please check all fields and try again.",
      message: errorMessage,
    }

    if (process.env.NODE_ENV === "development") {
      errorResponse.debug = {
        errorMessage,
        errorType: error?.name || typeof error,
        errorString: error?.toString() || String(error),
        stack: error?.stack?.split("\n").slice(0, 10).join("\n") || null,
      }
    }

    try {
      return NextResponse.json(errorResponse, { status: 500 })
    } catch (responseError: any) {
      console.error("CRITICAL: Failed to create error response:", responseError)
      return new NextResponse(
        JSON.stringify({
          success: false,
          error: "Proforma invoice could not be created",
          message: errorMessage,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      )
    }
  }
}
