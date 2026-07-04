import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { enforceServiceIndustryFinancialWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite"
import {
  mapProformaItemsForInsert,
  resolveValidProductServiceIds,
  validateDocumentLineMaterials,
} from "@/lib/documents/documentLineMaterials"
import { getTaxEngineCode, deriveLegacyTaxColumnsFromTaxLines, getCanonicalTaxResultFromLineItems } from "@/lib/taxEngine/helpers"
import { toTaxLinesJsonb } from "@/lib/taxEngine/serialize"
import { createAuditLog } from "@/lib/auditLog"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { canEditProforma, shouldCreateRevision } from "@/lib/documentState"
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

    const requestedBusinessId = new URL(request.url).searchParams.get("business_id")
    const scope = await resolveBusinessScopeForUser(supabase, user.id, requestedBusinessId)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
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
          whatsapp_phone,
          address,
          tin
        )
      `
      )
      .eq("id", proformaId)
      .eq("business_id", scope.businessId)
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

    let pendingRevisionId: string | null = null
    if (
      proforma.status === "sent" &&
      proforma.proforma_number &&
      proforma.revision_number != null
    ) {
      const nextRevisionNumber = (proforma.revision_number || 1) + 1
      const { data: pendingRevision } = await supabase
        .from("proforma_invoices")
        .select("id")
        .eq("business_id", scope.businessId)
        .eq("proforma_number", proforma.proforma_number)
        .eq("revision_number", nextRevisionNumber)
        .eq("supersedes_id", proformaId)
        .eq("status", "draft")
        .is("deleted_at", null)
        .maybeSingle()
      pendingRevisionId = pendingRevision?.id ?? null
    }

    return NextResponse.json({
      proforma,
      items: items || [],
      pending_revision_id: pendingRevisionId,
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

    const body = await request.json()
    const requestedBusinessId =
      (typeof body.business_id === "string" && body.business_id.trim()) ||
      new URL(request.url).searchParams.get("business_id") ||
      undefined
    const scope = await resolveBusinessScopeForUser(supabase, user.id, requestedBusinessId)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const writeDenied = await enforceServiceIndustryFinancialWrite(
      supabase,
      user.id,
      scope.businessId,
      "starter"
    )
    if (writeDenied) return writeDenied

    const { data: existingProforma } = await supabase
      .from("proforma_invoices")
      .select("id, business_id, status, apply_taxes, revision_number, proforma_number")
      .eq("id", proformaId)
      .eq("business_id", scope.businessId)
      .is("deleted_at", null)
      .single()

    if (!existingProforma) {
      return NextResponse.json(
        { error: "Proforma invoice not found" },
        { status: 404 }
      )
    }

    if (!canEditProforma(existingProforma.status as any)) {
      return NextResponse.json(
        {
          error: `Cannot edit proforma with status "${existingProforma.status}". Only draft and sent proformas can be edited.`,
        },
        { status: 400 }
      )
    }

    const shouldCreateNewRevision = shouldCreateRevision("proforma", existingProforma.status)

    const {
      business_id: _bodyBusinessId,
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
      .eq("id", scope.businessId)
      .single()

    const shouldApplyTaxes =
      apply_taxes !== undefined ? apply_taxes : existingProforma.apply_taxes !== false

    let updateData: any = {
      updated_at: new Date().toISOString(),
    }

    let materialValidationForItems: Awaited<
      ReturnType<typeof validateDocumentLineMaterials>
    > | null = null

    if (items && items.length > 0) {
      materialValidationForItems = await validateDocumentLineMaterials(
        supabase,
        scope.businessId,
        items
      )
      if (!materialValidationForItems.ok) {
        return NextResponse.json(
          { error: materialValidationForItems.error },
          { status: materialValidationForItems.status }
        )
      }

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

    let finalProformaId = proformaId
    let finalProforma: Record<string, unknown> | null = null
    let createdNewRevision = false
    let reusedExistingRevision = false

    if (shouldCreateNewRevision) {
      const { data: originalProforma, error: origError } = await supabase
        .from("proforma_invoices")
        .select("*")
        .eq("id", proformaId)
        .eq("business_id", scope.businessId)
        .is("deleted_at", null)
        .single()

      if (origError || !originalProforma) {
        return NextResponse.json(
          { error: "Original proforma invoice not found" },
          { status: 404 }
        )
      }

      const nextRevisionNumber = (originalProforma.revision_number || 1) + 1

      const { data: existingDraftRevision } = await supabase
        .from("proforma_invoices")
        .select("*")
        .eq("business_id", scope.businessId)
        .eq("proforma_number", originalProforma.proforma_number)
        .eq("revision_number", nextRevisionNumber)
        .eq("supersedes_id", proformaId)
        .eq("status", "draft")
        .is("deleted_at", null)
        .maybeSingle()

      if (existingDraftRevision) {
        reusedExistingRevision = true
        finalProformaId = existingDraftRevision.id

        const { data: updatedRevision, error: reuseUpdateError } = await supabase
          .from("proforma_invoices")
          .update(updateData)
          .eq("id", finalProformaId)
          .eq("business_id", scope.businessId)
          .select()
          .single()

        if (reuseUpdateError || !updatedRevision) {
          console.error("Error updating existing proforma revision:", reuseUpdateError)
          return NextResponse.json(
            {
              success: false,
              error:
                reuseUpdateError?.message ||
                "Failed to update existing proforma revision draft",
            },
            { status: 500 }
          )
        }

        finalProforma = updatedRevision
      } else {
      const { data: newRevision, error: revisionError } = await supabase
        .from("proforma_invoices")
        .insert({
          business_id: scope.businessId,
          customer_id:
            customer_id !== undefined ? customer_id : originalProforma.customer_id,
          proforma_number: originalProforma.proforma_number,
          status: "draft",
          revision_number: nextRevisionNumber,
          supersedes_id: proformaId,
          issue_date:
            issue_date !== undefined ? issue_date : originalProforma.issue_date,
          validity_date:
            validity_date !== undefined
              ? validity_date || null
              : originalProforma.validity_date,
          subtotal: updateData.subtotal ?? originalProforma.subtotal,
          total_tax: updateData.total_tax ?? originalProforma.total_tax,
          total: updateData.total ?? originalProforma.total,
          nhil: updateData.nhil ?? originalProforma.nhil,
          getfund: updateData.getfund ?? originalProforma.getfund,
          covid: updateData.covid ?? originalProforma.covid,
          vat: updateData.vat ?? originalProforma.vat,
          currency_code: originalProforma.currency_code,
          currency_symbol: originalProforma.currency_symbol,
          payment_terms:
            payment_terms !== undefined
              ? payment_terms || null
              : originalProforma.payment_terms,
          notes: notes !== undefined ? notes || null : originalProforma.notes,
          footer_message:
            footer_message !== undefined
              ? footer_message || null
              : originalProforma.footer_message,
          apply_taxes:
            apply_taxes !== undefined ? apply_taxes : originalProforma.apply_taxes,
          public_token: null,
          tax_lines: updateData.tax_lines ?? originalProforma.tax_lines,
          tax_engine_code: updateData.tax_engine_code ?? originalProforma.tax_engine_code,
          tax_jurisdiction:
            updateData.tax_jurisdiction ?? originalProforma.tax_jurisdiction,
          tax_engine_effective_from:
            updateData.tax_engine_effective_from ??
            originalProforma.tax_engine_effective_from,
          source_estimate_id: originalProforma.source_estimate_id,
          converted_invoice_id: null,
          sent_at: null,
          accepted_at: null,
        })
        .select()
        .single()

      if (revisionError || !newRevision) {
        console.error("Error creating proforma revision:", revisionError)
        return NextResponse.json(
          {
            success: false,
            error: revisionError?.message || "Failed to create proforma revision",
          },
          { status: 500 }
        )
      }

      finalProformaId = newRevision.id
      finalProforma = newRevision
      createdNewRevision = true
      }
    } else {
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

      finalProforma = updatedProforma
    }

    // Replace line items if provided
    if (items && items.length > 0) {
      if (!shouldCreateNewRevision || reusedExistingRevision) {
        await supabase
          .from("proforma_invoice_items")
          .delete()
          .eq("proforma_invoice_id", finalProformaId)
      }

      const validProductServiceIds = await resolveValidProductServiceIds(supabase, items)

      const validMaterialIds =
        materialValidationForItems && materialValidationForItems.ok
          ? materialValidationForItems.validMaterialIds
          : new Set<string>()

      const proformaItems = mapProformaItemsForInsert(
        finalProformaId,
        items,
        validProductServiceIds,
        validMaterialIds
      )

      const { error: itemsError } = await supabase
        .from("proforma_invoice_items")
        .insert(proformaItems)

      if (itemsError) {
        console.error("Error updating proforma invoice items:", itemsError)

        if (createdNewRevision && finalProformaId !== proformaId) {
          await supabase
            .from("proforma_invoice_items")
            .delete()
            .eq("proforma_invoice_id", finalProformaId)
          await supabase
            .from("proforma_invoices")
            .delete()
            .eq("id", finalProformaId)
            .eq("business_id", scope.businessId)
        }

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
      businessId: scope.businessId,
      userId: user?.id || null,
      actionType: createdNewRevision ? "proforma.revision_created" : "proforma.updated",
      entityType: "proforma_invoice",
      entityId: finalProformaId,
      oldValues: existingProforma,
      newValues: finalProforma,
      description: createdNewRevision
        ? `Created revision for proforma ${existingProforma.proforma_number || proformaId}`
        : undefined,
      request,
    })

    return NextResponse.json({
      success: true,
      proforma: finalProforma,
      isRevision: createdNewRevision,
      reusedExistingRevision,
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
