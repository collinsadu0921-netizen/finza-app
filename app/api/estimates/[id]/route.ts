import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireBusinessScopeForUser, resolveBusinessScopeForUser } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { getTaxEngineCode, deriveLegacyTaxColumnsFromTaxLines, getCanonicalTaxResultFromLineItems } from "@/lib/taxEngine/helpers"
import { toTaxLinesJsonb } from "@/lib/taxEngine/serialize"
import { normalizeCountry } from "@/lib/payments/eligibility"
import type { TaxEngineConfig } from "@/lib/taxEngine/types"
import { canEditEstimate, shouldCreateRevision } from "@/lib/documentState"

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
    const scope = await resolveBusinessScopeForUser(supabase, user.id, requestedBusinessId)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const scopedBusinessId = scope.businessId

    // Fetch estimate (id + tenant)
    const { data: estimateRow, error: estimateError } = await supabase
      .from("estimates")
      .select("*")
      .eq("id", estimateId)
      .eq("business_id", scopedBusinessId)
      .is("deleted_at", null)
      .single()

    if (estimateError || !estimateRow) {
      return NextResponse.json(
        { error: "Estimate not found", details: estimateError?.message },
        { status: 404 }
      )
    }

    const customerId = estimateRow.customer_id
    let customers: { id: string; name: string; email: string | null; phone: string | null; whatsapp_phone: string | null; address: string | null; tin: string | null } | null = null
    if (customerId) {
      const { data: cust } = await supabase
        .from("customers")
        .select("id, name, email, phone, whatsapp_phone, address, tin")
        .eq("id", customerId)
        .single()
      customers = cust ?? null
    }
    const estimate = { ...estimateRow, customers }

    // Fetch estimate items
    const { data: items, error: itemsError } = await supabase
      .from("estimate_items")
      .select("*")
      .eq("estimate_id", estimateId)
      .order("created_at", { ascending: true })

    if (itemsError) {
      console.error("Error fetching estimate items:", itemsError)
      console.error("Error details:", {
        message: itemsError.message,
        code: itemsError.code,
        details: itemsError.details,
        hint: itemsError.hint
      })
    }

    console.log(`Fetched ${items?.length || 0} items for estimate ${estimateId}`)
    if (items && items.length > 0) {
      console.log("Items data:", JSON.stringify(items, null, 2))
    } else {
      console.log("No items found for estimate. Checking if estimate_items table exists...")
    }

    return NextResponse.json({
      estimate,
      items: items || [],
    })
  } catch (error: any) {
    console.error("Error fetching estimate:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(
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
    const body = await request.json()
    const {
      business_id: bodyBusinessId,
      customer_id,
      estimate_number,
      issue_date,
      expiry_date,
      notes,
      items,
      apply_taxes = true,
    } = body

    const scope = await requireBusinessScopeForUser(supabase, user.id, bodyBusinessId)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const scopedBusinessId = scope.businessId

    const { data: existingEstimate, error: checkError } = await supabase
      .from("estimates")
      .select("id, status, business_id, revision_number, estimate_number")
      .eq("id", estimateId)
      .eq("business_id", scopedBusinessId)
      .single()

    if (checkError || !existingEstimate) {
      return NextResponse.json(
        { error: "Estimate not found" },
        { status: 404 }
      )
    }

    // Check if estimate can be edited
    if (!canEditEstimate(existingEstimate.status as any)) {
      return NextResponse.json(
        { error: `Cannot edit estimate with status "${existingEstimate.status}". Only draft and sent estimates can be edited.` },
        { status: 400 }
      )
    }

    const businessId = existingEstimate.business_id
    const shouldCreateNewRevision = shouldCreateRevision("estimate", existingEstimate.status)

    // Get business country for tax jurisdiction
    // CRITICAL: Fetch country - required for tax calculation
    const { data: businessRecord } = await supabase
      .from("businesses")
      .select("address_country")
      .eq("id", businessId)
      .single()

    // BLOCK estimate update if business country is missing (no silent fallback)
    if (!businessRecord?.address_country) {
      return NextResponse.json(
        { 
          success: false,
          error: "Business country is required. Please set your business country in Business Profile settings.",
          message: "Country required for tax calculation"
        },
        { status: 400 }
      )
    }

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
    // Effective date: Use estimate issue_date for tax calculation (recompute on every update)
    const effectiveDate = issue_date || new Date().toISOString().split('T')[0]

    // Recompute taxes canonically on every update (overwrite tax_lines and totals)
    const jurisdiction = normalizeCountry(businessRecord.address_country)
    if (!jurisdiction) {
      return NextResponse.json({ error: "Jurisdiction required", message: "Business country could not be resolved for tax calculation." }, { status: 400 })
    }
    const taxEngineCode = getTaxEngineCode(jurisdiction)
    const shouldApplyTaxes = apply_taxes !== undefined ? apply_taxes : true
    let taxResult: import('@/lib/taxEngine/types').TaxResult | null = null
    let baseSubtotal: number
    let estimateTotal: number
    let legacyTaxColumns: { nhil: number; getfund: number; covid: number; vat: number }
    
    if (shouldApplyTaxes) {
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

    // Prepare estimate update/insert data
    const estimateData = {
      customer_id: customer_id || null,
      estimate_number,
      issue_date,
      expiry_date: expiry_date || null,
      notes: notes || null,
      // Canonical tax values from TaxResult (already rounded to 2dp)
      subtotal: baseSubtotal,
      total_tax_amount: taxResult ? Math.round(taxResult.total_tax * 100) / 100 : 0,
      total_amount: estimateTotal,
      // Legacy columns derived from tax_lines
      subtotal_before_tax: baseSubtotal,
      nhil_amount: Math.round(legacyTaxColumns.nhil * 100) / 100,
      getfund_amount: Math.round(legacyTaxColumns.getfund * 100) / 100,
      covid_amount: Math.round(legacyTaxColumns.covid * 100) / 100,
      vat_amount: Math.round(legacyTaxColumns.vat * 100) / 100,
      tax: taxResult ? Math.round(taxResult.total_tax * 100) / 100 : 0,
      // Canonical tax_lines JSONB (source of truth)
      tax_lines: taxResult ? toTaxLinesJsonb(taxResult) : null,
      tax_engine_code: shouldApplyTaxes ? taxEngineCode : null,
      tax_engine_effective_from: shouldApplyTaxes ? effectiveDate : null,
      tax_jurisdiction: shouldApplyTaxes ? jurisdiction : null,
    }

    let finalEstimateId = estimateId
    let finalEstimate: any

    if (shouldCreateNewRevision) {
      // Editing a sent estimate: Create new draft revision
      // Fetch original estimate to copy all fields
      const { data: originalEstimate, error: origError } = await supabase
        .from("estimates")
        .select("*")
        .eq("id", estimateId)
        .eq("business_id", scopedBusinessId)
        .single()

      if (origError || !originalEstimate) {
        return NextResponse.json(
          { error: "Original estimate not found" },
          { status: 404 }
        )
      }

      // Get next revision number
      const nextRevisionNumber = (originalEstimate.revision_number || 1) + 1

      // Create new revision (draft)
      const { data: newRevision, error: revisionError } = await supabase
        .from("estimates")
        .insert({
          ...estimateData,
          business_id: businessId,
          status: "draft", // New revision starts as draft
          revision_number: nextRevisionNumber,
          supersedes_id: estimateId, // Link to original
          // Copy other fields from original
          converted_to: null, // Reset conversion status
          public_token: null, // Reset public token
        })
        .select()
        .single()

      if (revisionError || !newRevision) {
        return NextResponse.json(
          { error: revisionError?.message || "Failed to create revision" },
          { status: 500 }
        )
      }

      finalEstimateId = newRevision.id
      finalEstimate = newRevision

      // Copy estimate items to new revision
      const { data: originalItems } = await supabase
        .from("estimate_items")
        .select("*")
        .eq("estimate_id", estimateId)

      if (originalItems && originalItems.length > 0) {
        const newItems = originalItems.map((item: any) => ({
          estimate_id: finalEstimateId,
          description: item.description,
          quantity: item.quantity || item.qty || 0,
          price: item.price || item.unit_price || 0,
          total: item.total || item.line_total || 0,
          discount_amount: Number(item.discount_amount) || 0,
        }))

        await supabase.from("estimate_items").insert(newItems)
      }
    } else {
      // Editing a draft: Update in place
      const { data: updatedEstimate, error: updateError } = await supabase
        .from("estimates")
        .update(estimateData)
        .eq("id", estimateId)
        .eq("business_id", scopedBusinessId)
        .select()
        .single()

      if (updateError) {
        return NextResponse.json(
          { error: updateError.message },
          { status: 500 }
        )
      }

      finalEstimate = updatedEstimate

      // Delete existing items and insert new ones
      await supabase.from("estimate_items").delete().eq("estimate_id", estimateId)
    }

    // Prepare new items
    const estimateItems = items.map((item: any) => {
      const qty = Number(item.qty || item.quantity) || 0
      const price = Number(item.unit_price || item.price) || 0
      const discount = Number(item.discount_amount) || 0
      const total = Math.round(Math.max(0, (qty * price) - discount) * 100) / 100

      return {
        estimate_id: finalEstimateId,
        description: item.description || "",
        quantity: qty,
        price: price,
        total: total,
        discount_amount: discount,
      }
    })

    // Insert new items (or update if creating revision)
    const { error: itemsError } = await supabase
      .from("estimate_items")
      .insert(estimateItems)

    if (itemsError) {
      return NextResponse.json(
        { error: itemsError.message },
        { status: 500 }
      )
    }

    await createAuditLog({
      businessId: finalEstimate.business_id,
      actionType: "estimate.updated",
      entityType: "estimates",
      entityId: finalEstimate.id,
      newValues: {
        estimate_number: finalEstimate.estimate_number,
        revision: shouldCreateNewRevision,
      },
      description: shouldCreateNewRevision
        ? `Created revision for quote ${finalEstimate.estimate_number || finalEstimate.id}`
        : `Updated quote ${finalEstimate.estimate_number || finalEstimate.id}`,
      request,
    })

    return NextResponse.json({
      success: true,
      estimateId: finalEstimate.id,
      estimate: finalEstimate,
      isRevision: shouldCreateNewRevision,
    })
  } catch (error: any) {
    console.error("Error updating estimate:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

