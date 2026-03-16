import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { getTaxEngineCode, deriveLegacyTaxColumnsFromTaxLines, getCanonicalTaxResultFromLineItems } from "@/lib/taxEngine/helpers"
import { toTaxLinesJsonb } from "@/lib/taxEngine/serialize"
import { normalizeCountry } from "@/lib/payments/eligibility"
import type { TaxEngineConfig } from "@/lib/taxEngine/types"
import { createReconciliationEngine } from "@/lib/accounting/reconciliation/engine-impl"
import { ReconciliationContext, ReconciliationStatus } from "@/lib/accounting/reconciliation/types"
import { logReconciliationMismatch } from "@/lib/accounting/reconciliation/mismatch-logger"

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
      business_id,
      invoice_id,
      credit_number,
      date,
      reason,
      notes,
      items,
      apply_taxes = true,
    } = body

    if (!invoice_id) {
      console.warn("[credit-notes/create] invoice_id is missing in request body")
    }

    // Validate required fields
    if (!business_id || !invoice_id || !date || !items || items.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business || business.id !== business_id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const { data: invoice } = await supabase
      .from("invoices")
      .select("id, total, subtotal, total_tax, customer_id")
      .eq("id", invoice_id)
      .eq("business_id", business_id)
      .is("deleted_at", null)
      .single()

    if (!invoice) {
      return NextResponse.json(
        { error: "Invoice not found" },
        { status: 404 }
      )
    }

    // Get business country for tax calculation
    const { data: businessProfile } = await supabase
      .from("businesses")
      .select("address_country")
      .eq("id", business_id)
      .single()

    if (!businessProfile?.address_country) {
      return NextResponse.json(
        { 
          success: false,
          error: "Business country is required for tax calculation.",
          message: "Country required"
        },
        { status: 400 }
      )
    }

    const countryCode = normalizeCountry(businessProfile.address_country)
    if (!countryCode) {
      return NextResponse.json(
        { 
          success: false,
          error: "Business country could not be normalized for tax calculation.",
          message: "Invalid country"
        },
        { status: 400 }
      )
    }

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

    // Determine effective date: use credit note date
    const effectiveDate = date.split('T')[0] // YYYY-MM-DD format

    // Calculate taxes using canonical tax engine (tax-inclusive mode)
    const jurisdiction = countryCode
    const taxEngineCode = getTaxEngineCode(jurisdiction)
    let taxResult: import('@/lib/taxEngine/types').TaxResult | null = null
    let baseSubtotal: number
    let creditNoteTotal: number
    let legacyTaxColumns: { nhil: number; getfund: number; covid: number; vat: number }
    
    if (apply_taxes) {
      // Use canonical tax engine
      const config: TaxEngineConfig = {
        jurisdiction,
        effectiveDate,
        taxInclusive: true, // Credit notes always use tax-inclusive pricing (like invoices)
      }
      
      taxResult = getCanonicalTaxResultFromLineItems(lineItems, config)
      
      // Persist canonical values (rounded to 2dp)
      baseSubtotal = Math.round(taxResult.base_amount * 100) / 100
      creditNoteTotal = Math.round(taxResult.total_amount * 100) / 100
      
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
      creditNoteTotal = Math.round(subtotal * 100) / 100
      legacyTaxColumns = { nhil: 0, getfund: 0, covid: 0, vat: 0 }
    }
    
    // Validate calculated values
    if (isNaN(baseSubtotal) || baseSubtotal < 0 || isNaN(creditNoteTotal) || creditNoteTotal < 0) {
      console.error("Invalid tax calculation:", { baseSubtotal, creditNoteTotal, taxResult })
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

    // Check if credit note would exceed invoice balance (gross vs gross)
    const { data: existingPayments } = await supabase
      .from("payments")
      .select("amount")
      .eq("invoice_id", invoice_id)
      .is("deleted_at", null)

    const { data: existingCredits } = await supabase
      .from("credit_notes")
      .select("total")
      .eq("invoice_id", invoice_id)
      .eq("status", "applied")
      .is("deleted_at", null)

    const rawTotal = Number(invoice.total || 0)
    const derivedGross = Math.round((Number(invoice.subtotal || 0) + Number(invoice.total_tax || 0)) * 100) / 100
    const invoiceGross = rawTotal > 0 ? rawTotal : derivedGross
    const paymentsGross =
      (existingPayments ?? []).reduce((sum, p) => sum + Number(p.amount), 0)
    const creditsGross =
      (existingCredits ?? []).reduce((sum, c) => sum + Number(c.total), 0)
    const remainingGross = invoiceGross - paymentsGross - creditsGross

    const remainingGrossRounded = Math.round(remainingGross * 100) / 100
    const creditTotalRounded = Math.round(creditNoteTotal * 100) / 100

    if (creditTotalRounded > remainingGrossRounded) {
      const hint = remainingGrossRounded === 0 && invoiceGross === 0
        ? " Invoice total may be missing or zero; check the invoice."
        : ""
      return NextResponse.json(
        { error: `Credit note amount (₵${creditTotalRounded.toFixed(2)}) cannot exceed invoice balance (₵${remainingGrossRounded.toFixed(2)}).${hint}` },
        { status: 400 }
      )
    }

    // Ledger reconciliation check (VALIDATE) — observe only, do not block
    try {
      const engine = createReconciliationEngine(supabase)
      const result = await engine.reconcileInvoice(
        { businessId: business_id, invoiceId: invoice_id },
        ReconciliationContext.VALIDATE
      )
      if (result.status !== ReconciliationStatus.OK) {
        logReconciliationMismatch(result)
      }
    } catch (_err) {
      // Do not block; log and continue
    }

    // Generate credit note number if not provided
    let finalCreditNumber = credit_number
    if (!finalCreditNumber) {
      const { data: creditNumData } = await supabase.rpc("generate_credit_note_number", {
        business_uuid: business_id,
      })
      finalCreditNumber = creditNumData || `CN-${Date.now()}`
    }

    // Generate public token
    let publicToken: string
    try {
      const { data: tokenData } = await supabase.rpc("generate_public_token")
      publicToken = tokenData || Buffer.from(`${business_id}-${invoice_id}-${Date.now()}`).toString("base64url")
    } catch (tokenError) {
      publicToken = Buffer.from(`${business_id}-${invoice_id}-${Date.now()}`).toString("base64url")
    }

    // Create credit note. Credit notes do NOT have apply_taxes; tax comes from tax_lines only.
    const creditNoteData: any = {
      business_id,
      invoice_id,
      credit_number: finalCreditNumber,
      date,
      reason: reason || null,
      notes: notes || null,
      subtotal: baseSubtotal,
      total_tax: taxResult ? Math.round(taxResult.total_tax * 100) / 100 : 0,
      total: creditNoteTotal,
      status: "draft",
      public_token: publicToken,
      tax_lines: taxResult ? toTaxLinesJsonb(taxResult) : null,
      tax_engine_code: taxResult ? taxEngineCode : null,
      tax_engine_effective_from: taxResult ? effectiveDate : null,
      tax_jurisdiction: taxResult ? jurisdiction : null,
      nhil: taxResult ? Math.round(legacyTaxColumns.nhil * 100) / 100 : 0,
      getfund: taxResult ? Math.round(legacyTaxColumns.getfund * 100) / 100 : 0,
      covid: taxResult ? Math.round(legacyTaxColumns.covid * 100) / 100 : 0,
      vat: taxResult ? Math.round(legacyTaxColumns.vat * 100) / 100 : 0,
    }

    const { data: creditNote, error: creditNoteError } = await supabase
      .from("credit_notes")
      .insert(creditNoteData)
      .select("id, business_id, invoice_id, credit_number, date, reason, subtotal, nhil, getfund, covid, vat, total_tax, total, status, notes, public_token, created_at, updated_at, deleted_at, tax_lines, tax_engine_code, tax_engine_effective_from, tax_jurisdiction")
      .single()

    if (creditNoteError) {
      console.error("Error creating credit note:", creditNoteError)
      return NextResponse.json(
        { error: creditNoteError.message },
        { status: 500 }
      )
    }

    // Create credit note items
    const creditNoteItems = items.map((item: any) => ({
      credit_note_id: creditNote.id,
      invoice_item_id: item.invoice_item_id || null,
      description: item.description || "",
      qty: Number(item.qty) || 0,
      unit_price: Number(item.unit_price) || 0,
      discount_amount: Number(item.discount_amount) || 0,
      line_subtotal: (Number(item.qty) || 0) * (Number(item.unit_price) || 0) - (Number(item.discount_amount) || 0),
    }))

    const { error: itemsError } = await supabase
      .from("credit_note_items")
      .insert(creditNoteItems)

    if (itemsError) {
      console.error("Error creating credit note items:", itemsError)
      // Delete the credit note if items fail
      await supabase.from("credit_notes").delete().eq("id", creditNote.id)
      return NextResponse.json(
        { error: itemsError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ creditNote }, { status: 201 })
  } catch (error: any) {
    console.error("Error creating credit note:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

