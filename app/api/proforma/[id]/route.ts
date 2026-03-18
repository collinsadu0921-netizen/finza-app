import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { getTaxEngineCode, deriveLegacyTaxColumnsFromTaxLines, getCanonicalTaxResultFromLineItems } from "@/lib/taxEngine/helpers"
import { toTaxLinesJsonb } from "@/lib/taxEngine/serialize"
import { createAuditLog } from "@/lib/auditLog"
import { normalizeCountry } from "@/lib/payments/eligibility"
import type { TaxEngineConfig } from "@/lib/taxEngine/types"

export async function GET(
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

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const { data: proforma, error: proformaError } = await supabase
      .from("proforma_invoices")
      .select(
        `
        *,
        customers (
          id,
          name,
          email,
          phone,
          address,
          tin
        )
      `
      )
      .eq("id", proformaId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (proformaError || !proforma) {
      console.error("Error fetching proforma invoice:", proformaError)
      return NextResponse.json(
        { error: "Proforma invoice not found", details: proformaError?.message },
        { status: 404 }
      )
    }

    const { data: items, error: itemsError } = await supabase
      .from("proforma_invoice_items")
      .select(
        `
        *,
        products_services (
          id,
          name,
          type
        )
      `
      )
      .eq("proforma_invoice_id", proformaId)
      .order("created_at", { ascending: true })

    if (itemsError) {
      console.error("Error fetching proforma invoice items:", itemsError)
    }

    return NextResponse.json({
      proforma,
      items: items || [],
    })
  } catch (error: any) {
    console.error("Error fetching proforma invoice:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PATCH(
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

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const { data: existingProforma } = await supabase
      .from("proforma_invoices")
      .select("id, business_id, status, apply_taxes")
      .eq("id", proformaId)
      .eq("business_id", business.id)
      .single()

    if (!existingProforma) {
      return NextResponse.json(
        { error: "Proforma invoice not found" },
        { status: 404 }
      )
    }

    if (existingProforma.status !== "draft") {
      return NextResponse.json(
        { error: "Only draft proformas can be edited" },
        { status: 400 }
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
      apply_taxes,
      items,
    } = body

    // Get business profile for tax calculation
    const { data: businessProfile } = await supabase
      .from("businesses")
      .select("address_country, default_currency")
      .eq("id", business.id)
      .single()

    const shouldApplyTaxes =
      apply_taxes !== undefined ? apply_taxes : existingProforma.apply_taxes !== false

    let updateData: any = {
      updated_at: new Date().toISOString(),
    }

    if (items && items.length > 0) {
      // Prepare line items for tax calculation
      const lineItems = items.map((item: any) => ({
        quantity: Number(item.qty) || 0,
        unit_price: Number(item.unit_price) || 0,
        discount_amount: Number(item.discount_amount) || 0,
      }))

      const effectiveDateForCalculation =
        issue_date || new Date().toISOString().split("T")[0]

      const jurisdiction = businessProfile?.address_country
        ? normalizeCountry(businessProfile.address_country)
        : null

      if (shouldApplyTaxes && jurisdiction) {
        const taxEngineCode = getTaxEngineCode(jurisdiction)
        const config: TaxEngineConfig = {
          jurisdiction,
          effectiveDate: effectiveDateForCalculation,
          taxInclusive: true,
        }

        const taxResult = getCanonicalTaxResultFromLineItems(lineItems, config)

        const baseSubtotal = Math.round(taxResult.base_amount * 100) / 100
        const proformaTotal = Math.round(taxResult.total_amount * 100) / 100
        const legacyTaxColumns = deriveLegacyTaxColumnsFromTaxLines(taxResult.lines)

        updateData.subtotal = baseSubtotal
        updateData.total_tax = Math.round(taxResult.total_tax * 100) / 100
        updateData.total = proformaTotal
        updateData.tax_lines = toTaxLinesJsonb(taxResult)
        updateData.tax_engine_code = taxEngineCode
        updateData.tax_engine_effective_from = effectiveDateForCalculation
        updateData.tax_jurisdiction = jurisdiction
        updateData.nhil = Math.round(legacyTaxColumns.nhil * 100) / 100
        updateData.getfund = Math.round(legacyTaxColumns.getfund * 100) / 100
        updateData.covid = Math.round(legacyTaxColumns.covid * 100) / 100
        updateData.vat = Math.round(legacyTaxColumns.vat * 100) / 100
      } else {
        const subtotal = lineItems.reduce((sum: number, item: any) => {
          const lineTotal = item.quantity * item.unit_price
          const discount = item.discount_amount || 0
          return sum + Math.round((lineTotal - discount) * 100) / 100
        }, 0)

        updateData.subtotal = Math.round(subtotal * 100) / 100
        updateData.total_tax = 0
        updateData.total = Math.round(subtotal * 100) / 100
        updateData.tax_lines = null
        updateData.tax_engine_code = null
        updateData.tax_engine_effective_from = null
        updateData.tax_jurisdiction = null
        updateData.nhil = 0
        updateData.getfund = 0
        updateData.covid = 0
        updateData.vat = 0
      }
    }

    if (customer_id !== undefined) updateData.customer_id = customer_id
    if (issue_date !== undefined) updateData.issue_date = issue_date
    if (validity_date !== undefined) updateData.validity_date = validity_date || null
    if (payment_terms !== undefined) updateData.payment_terms = payment_terms || null
    if (notes !== undefined) updateData.notes = notes || null
    if (footer_message !== undefined) updateData.footer_message = footer_message || null
    if (apply_taxes !== undefined) updateData.apply_taxes = apply_taxes

    const { data: updatedProforma, error: updateError } = await supabase
      .from("proforma_invoices")
      .update(updateData)
      .eq("id", proformaId)
      .select()
      .single()

    if (updateError) {
      console.error("Error updating proforma invoice:", updateError)
      return NextResponse.json(
        {
          success: false,
          error: "Proforma invoice could not be updated. Please check all fields and try again.",
          code: updateError.code,
          details: { message: updateError.message },
        },
        { status: 500 }
      )
    }

    // Replace line items if provided
    if (items && items.length > 0) {
      await supabase
        .from("proforma_invoice_items")
        .delete()
        .eq("proforma_invoice_id", proformaId)

      // Validate product_service_id references
      const candidateIds = [
        ...new Set(items.map((item: any) => item.product_service_id).filter(Boolean)),
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

      const proformaItems = items.map((item: any) => {
        const rawId = item.product_service_id || null
        const product_service_id =
          rawId && validProductServiceIds.has(rawId) ? rawId : null
        return {
          proforma_invoice_id: proformaId,
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
        console.error("Error updating proforma invoice items:", itemsError)
        return NextResponse.json(
          {
            success: false,
            error: "Failed to update proforma invoice line items.",
            code: itemsError.code,
            details: { message: itemsError.message },
          },
          { status: 500 }
        )
      }
    }

    // Log audit entry
    await createAuditLog({
      businessId: business.id,
      userId: user?.id || null,
      actionType: "proforma.updated",
      entityType: "proforma_invoice",
      entityId: proformaId,
      oldValues: existingProforma,
      newValues: updatedProforma,
      request,
    })

    return NextResponse.json({
      success: true,
      proforma: updatedProforma,
    })
  } catch (error: any) {
    console.error("Error updating proforma invoice:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Proforma invoice could not be updated. Please check all fields and try again.",
        code: "INTERNAL_ERROR",
        details: error?.message ?? (typeof error === "string" ? error : "Internal server error"),
      },
      { status: 500 }
    )
  }
}
