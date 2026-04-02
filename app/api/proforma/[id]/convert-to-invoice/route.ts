import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { getTaxEngineCode, deriveLegacyTaxColumnsFromTaxLines, getCanonicalTaxResultFromLineItems } from "@/lib/taxEngine/helpers"
import { toTaxLinesJsonb } from "@/lib/taxEngine/serialize"
import { createAuditLog } from "@/lib/auditLog"
import { assertBusinessNotArchived } from "@/lib/archivedBusiness"
import { getCurrencySymbol } from "@/lib/currency"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { assertCountryCurrency } from "@/lib/countryCurrency"
import type { TaxEngineConfig } from "@/lib/taxEngine/types"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const proformaId = resolvedParams.id

    if (!proformaId) {
      return NextResponse.json(
        { error: "Proforma invoice ID is required" },
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

    const body = await request.json().catch(() => ({}))
    const requestedBusinessId =
      (typeof body.business_id === "string" && body.business_id.trim()) ||
      new URL(request.url).searchParams.get("business_id") ||
      undefined
    const scope = await resolveBusinessScopeForUser(supabase, user.id, requestedBusinessId)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    // Fetch proforma and verify ownership
    const { data: proforma, error: proformaError } = await supabase
      .from("proforma_invoices")
      .select("*")
      .eq("id", proformaId)
      .eq("business_id", scope.businessId)
      .is("deleted_at", null)
      .single()

    if (proformaError || !proforma) {
      return NextResponse.json(
        { error: "Proforma invoice not found" },
        { status: 404 }
      )
    }

    if (proforma.status !== "accepted") {
      return NextResponse.json(
        { error: "Only accepted proformas can be converted to invoice" },
        { status: 400 }
      )
    }

    // Fetch proforma items
    const { data: proformaItems, error: itemsError } = await supabase
      .from("proforma_invoice_items")
      .select("*")
      .eq("proforma_invoice_id", proformaId)
      .order("created_at", { ascending: true })

    if (itemsError) {
      console.error("Error fetching proforma items:", itemsError)
      return NextResponse.json(
        { error: "Failed to fetch proforma invoice items." },
        { status: 500 }
      )
    }

    const business_id = scope.businessId

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

    // Block conversion if business country is missing
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

    // Get currency from business settings
    const businessCurrencyCode = proforma.currency_code || businessProfile?.default_currency
    if (!businessCurrencyCode) {
      return NextResponse.json(
        {
          success: false,
          error: "Business currency is required. Please set your default currency in Business Profile settings.",
          message: "Currency required for invoice creation",
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
          message: error.message || "Currency-country mismatch",
        },
        { status: 400 }
      )
    }

    // Map currency code to symbol
    const businessCurrencySymbol =
      proforma.currency_symbol || getCurrencySymbol(businessCurrencyCode)
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

    // Re-run tax calculation on proforma items
    const lineItems = (proformaItems || []).map((item: any) => ({
      quantity: Number(item.qty) || 0,
      unit_price: Number(item.unit_price) || 0,
      discount_amount: Number(item.discount_amount) || 0,
    }))

    const today = new Date().toISOString().split("T")[0]
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
    let invoiceTotal: number
    let legacyTaxColumns: { nhil: number; getfund: number; covid: number; vat: number }

    const apply_taxes = proforma.apply_taxes !== false

    if (apply_taxes) {
      const config: TaxEngineConfig = {
        jurisdiction,
        effectiveDate: today,
        taxInclusive: true,
      }

      taxResult = getCanonicalTaxResultFromLineItems(lineItems, config)

      baseSubtotal = Math.round(taxResult.base_amount * 100) / 100
      invoiceTotal = Math.round(taxResult.total_amount * 100) / 100
      legacyTaxColumns = deriveLegacyTaxColumnsFromTaxLines(taxResult.lines)
    } else {
      const subtotal = lineItems.reduce((sum: number, item: any) => {
        const lineTotal = item.quantity * item.unit_price
        const discount = item.discount_amount || 0
        return sum + Math.round((lineTotal - discount) * 100) / 100
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
          message: "Tax calculation error",
        },
        { status: 400 }
      )
    }

    // Generate invoice number
    const { data: invoiceNumData } = await supabase.rpc(
      "generate_invoice_number_with_settings",
      { business_uuid: business_id }
    )
    const finalInvoiceNumber = invoiceNumData || null
    if (!finalInvoiceNumber) {
      return NextResponse.json(
        { error: "Failed to generate invoice number. Please try again." },
        { status: 500 }
      )
    }

    // Generate public token for the new invoice
    let publicToken: string
    try {
      const { data: tokenData } = await supabase.rpc("generate_public_token")
      publicToken = tokenData || Buffer.from(`${business_id}-${Date.now()}`).toString("base64url")
    } catch (tokenError) {
      publicToken = Buffer.from(`${business_id}-${Date.now()}`).toString("base64url")
    }

    const sentAt = new Date().toISOString()

    // Build invoice data from proforma
    const invoiceData: any = {
      business_id,
      customer_id: proforma.customer_id || null,
      invoice_number: finalInvoiceNumber,
      issue_date: today,
      due_date: null,
      payment_terms: proforma.payment_terms || null,
      notes: proforma.notes || null,
      footer_message: proforma.footer_message || null,
      currency_code: businessCurrencyCode,
      currency_symbol: businessCurrencySymbol,
      subtotal: baseSubtotal,
      total_tax: taxResult ? Math.round(taxResult.total_tax * 100) / 100 : 0,
      total: invoiceTotal,
      apply_taxes,
      status: "sent",
      sent_at: sentAt,
      public_token: publicToken,
      tax_lines: taxResult ? toTaxLinesJsonb(taxResult) : null,
      tax_engine_code: apply_taxes ? taxEngineCode : null,
      tax_engine_effective_from: apply_taxes ? today : null,
      tax_jurisdiction: apply_taxes ? jurisdiction : null,
      nhil: apply_taxes ? Math.round(legacyTaxColumns.nhil * 100) / 100 : 0,
      getfund: apply_taxes ? Math.round(legacyTaxColumns.getfund * 100) / 100 : 0,
      covid: apply_taxes ? Math.round(legacyTaxColumns.covid * 100) / 100 : 0,
      vat: apply_taxes ? Math.round(legacyTaxColumns.vat * 100) / 100 : 0,
    }

    // Insert invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .insert(invoiceData)
      .select()
      .single()

    if (invoiceError) {
      console.error("Error creating invoice from proforma:", invoiceError)

      const msg = invoiceError.message ?? ""
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

      return NextResponse.json(
        {
          success: false,
          error: "Invoice could not be created from proforma. Please try again.",
          message: invoiceError.message,
          code: invoiceError.code,
        },
        { status: 500 }
      )
    }

    // Validate product_service_id references
    const candidateIds = [
      ...new Set(
        (proformaItems || [])
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

    // Insert invoice items copied from proforma items
    const invoiceItems = (proformaItems || []).map((item: any) => {
      const rawId = item.product_service_id || null
      const product_service_id =
        rawId && validProductServiceIds.has(rawId) ? rawId : null
      return {
        invoice_id: invoice.id,
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

    if (invoiceItems.length > 0) {
      const { error: invoiceItemsError } = await supabase
        .from("invoice_items")
        .insert(invoiceItems)

      if (invoiceItemsError) {
        console.error("Error creating invoice items from proforma:", invoiceItemsError)
        // Delete the invoice if items fail
        await supabase.from("invoices").delete().eq("id", invoice.id)
        return NextResponse.json(
          {
            success: false,
            error: "Invoice items could not be saved. Please try again.",
            message: invoiceItemsError.message,
          },
          { status: 500 }
        )
      }
    }

    // Mark proforma as converted
    const { error: proformaUpdateError } = await supabase
      .from("proforma_invoices")
      .update({
        status: "converted",
        converted_invoice_id: invoice.id,
      })
      .eq("id", proformaId)

    if (proformaUpdateError) {
      console.error("Error marking proforma as converted:", proformaUpdateError)
      // Non-fatal: invoice was created successfully
    }

    // Log audit entry
    await createAuditLog({
      businessId: business_id,
      userId: user?.id || null,
      actionType: "proforma.converted",
      entityType: "proforma_invoice",
      entityId: proformaId,
      oldValues: proforma,
      newValues: { ...proforma, status: "converted", converted_invoice_id: invoice.id },
      request,
    })

    return NextResponse.json(
      {
        success: true,
        invoiceId: invoice.id,
        invoice,
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error("Error converting proforma to invoice:", error)
    console.error("Error stack:", error.stack)

    const errorMessage = error?.message || error?.toString() || "Internal server error"

    const errorResponse: any = {
      success: false,
      error: "Proforma invoice could not be converted. Please check all fields and try again.",
      message: errorMessage,
    }

    if (process.env.NODE_ENV === "development") {
      errorResponse.debug = {
        errorMessage,
        errorType: error?.name || typeof error,
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
          error: "Proforma invoice could not be converted",
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
