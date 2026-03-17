import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { calculateTaxes, getLegacyTaxAmounts } from "@/lib/taxEngine"
import { deriveLegacyGhanaTaxAmounts, getTaxEngineCode, taxResultToJSONB } from "@/lib/taxEngine/helpers"
import { createAuditLog } from "@/lib/auditLog"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { createReconciliationEngine } from "@/lib/accounting/reconciliation/engine-impl"
import { ReconciliationContext, ReconciliationStatus } from "@/lib/accounting/reconciliation/types"
import { logReconciliationMismatch } from "@/lib/accounting/reconciliation/mismatch-logger"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle Next.js 16 params (can be Promise)
    const resolvedParams = await Promise.resolve(params)
    const invoiceId = resolvedParams.id

    if (!invoiceId) {
      return NextResponse.json(
        { error: "Invoice ID is required" },
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

    const { data: invoiceCheck, error: checkError } = await supabase
      .from("invoices")
      .select("id, business_id, deleted_at")
      .eq("id", invoiceId)
      .eq("business_id", business.id)
      .maybeSingle()

    if (checkError) {
      console.error("Error checking invoice:", checkError)
      return NextResponse.json(
        { error: "Error checking invoice", details: checkError.message },
        { status: 500 }
      )
    }

    if (!invoiceCheck) {
      return NextResponse.json(
        { error: "Invoice not found" },
        { status: 404 }
      )
    }

    if (invoiceCheck.deleted_at) {
      return NextResponse.json(
        { error: "Invoice has been deleted" },
        { status: 404 }
      )
    }

    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
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
        ),
        businesses (
          id,
          address_country
        )
      `
      )
      .eq("id", invoiceId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (invoiceError || !invoice) {
      console.error("Error fetching invoice:", invoiceError)
      return NextResponse.json(
        { error: "Invoice not found", details: invoiceError?.message },
        { status: 404 }
      )
    }

    // READ-TIME SAFETY NET: Auto-correct status if out of sync with ledger
    // Ledger reality (payments + credits) is the source of truth
    // Status is DERIVED, never authoritative
    if (invoice && invoice.status !== 'draft' && invoice.status !== 'paid') {
      // Calculate actual outstanding amount
      const { data: payments } = await supabase
        .from("payments")
        .select("amount")
        .eq("invoice_id", invoiceId)
        .is("deleted_at", null)

      const { data: creditNotes } = await supabase
        .from("credit_notes")
        .select("total")
        .eq("invoice_id", invoiceId)
        .eq("status", "applied")
        .is("deleted_at", null)

      const totalPaid = payments?.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0) || 0
      const totalCredits = creditNotes?.reduce((sum: number, cn: any) => sum + Number(cn.total || 0), 0) || 0
      const outstandingAmount = Number(invoice.total || 0) - totalPaid - totalCredits

      // If fully paid but status says otherwise, auto-correct via database function
      if (outstandingAmount <= 0 && invoice.status !== 'paid') {
        console.log(`[Invoice Status Auto-Correct] Invoice ${invoice.invoice_number}: status ${invoice.status} -> paid (outstanding: ${outstandingAmount})`)
        
        // Call database function to recalculate status (ensures consistency)
        await supabase.rpc('recalculate_invoice_status', { p_invoice_id: invoiceId })
        
        // Reload invoice to get updated status
        const { data: correctedInvoice } = await supabase
          .from("invoices")
          .select("*")
          .eq("id", invoiceId)
          .single()
        
        if (correctedInvoice) {
          invoice.status = correctedInvoice.status
          invoice.paid_at = correctedInvoice.paid_at
        }
      }
    }

    // If invoice was created from an order, fetch order details separately
    if (invoice.source_type === "order" && invoice.source_id) {
      const { data: orderData } = await supabase
        .from("orders")
        .select("id")
        .eq("id", invoice.source_id)
        .single()
      
      if (orderData) {
        // Add order reference to invoice object (orders table doesn't have order_number, so we generate it)
        ;(invoice as any).orders = {
          id: orderData.id,
          order_number: `ORD-${orderData.id.substring(0, 8).toUpperCase()}`,
        }
      }
    }

    const { data: items, error: itemsError } = await supabase
      .from("invoice_items")
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
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true })

    if (itemsError) {
      console.error("Error fetching invoice items:", itemsError)
    }

    // Get payments
    const { data: payments, error: paymentsError } = await supabase
      .from("payments")
      .select("*")
      .eq("invoice_id", invoiceId)
      .is("deleted_at", null)
      .order("date", { ascending: false })

    if (paymentsError) {
      console.error("Error fetching payments:", paymentsError)
    }

    // Get credit notes
    const { data: creditNotes, error: creditNotesError } = await supabase
      .from("credit_notes")
      .select("id, business_id, invoice_id, credit_number, date, reason, subtotal, nhil, getfund, covid, vat, total_tax, total, status, notes, public_token, created_at, updated_at, deleted_at, tax_lines, tax_engine_code, tax_engine_effective_from, tax_jurisdiction")
      .eq("invoice_id", invoiceId)
      .is("deleted_at", null)
      .order("date", { ascending: false })

    if (creditNotesError) {
      console.error("Error fetching credit notes:", creditNotesError)
    }

    // Read-only reconciliation for display: log mismatches, surface warning
    let reconciliationWarning: { status: string; expectedBalance: number; ledgerBalance: number; delta: number } | undefined
    if (invoice?.business_id) {
      try {
        const engine = createReconciliationEngine(supabase)
        const result = await engine.reconcileInvoice(
          { businessId: invoice.business_id, invoiceId },
          ReconciliationContext.DISPLAY
        )
        if (result.status !== ReconciliationStatus.OK) {
          logReconciliationMismatch(result)
          reconciliationWarning = {
            status: result.status,
            expectedBalance: result.expectedBalance,
            ledgerBalance: result.ledgerBalance,
            delta: result.delta,
          }
        }
      } catch (_err) {
        // Do not block or change response on reconcile failure
      }
    }

    const payload: Record<string, unknown> = {
      invoice,
      items: items || [],
      payments: payments || [],
      creditNotes: creditNotes || [],
    }
    if (reconciliationWarning) (payload as any).reconciliationWarning = reconciliationWarning

    return NextResponse.json(payload)
  } catch (error: any) {
    console.error("Error fetching invoice:", error)
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
    // Handle Next.js 16 params (can be Promise)
    const resolvedParams = await Promise.resolve(params)
    const invoiceId = resolvedParams.id

    if (!invoiceId) {
      return NextResponse.json(
        { error: "Invoice ID is required", code: "MISSING_ID" },
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
      apply_taxes,
      status,
    } = body

    const { data: existingInvoice } = await supabase
      .from("invoices")
      .select("id, business_id, status, sent_at, paid_at, apply_taxes, invoice_number")
      .eq("id", invoiceId)
      .eq("business_id", business.id)
      .single()

    if (!existingInvoice) {
      return NextResponse.json(
        { error: "Invoice not found", code: "NOT_FOUND" },
        { status: 404 }
      )
    }

    // Enforce invoice immutability: Invoices are immutable after issued
    const { canEditInvoice } = await import("@/lib/documentState")
    if (!canEditInvoice(existingInvoice.status as any)) {
      return NextResponse.json(
        {
          error: `Cannot edit invoice with status "${existingInvoice.status}". Invoices are immutable after being issued. Only draft invoices can be edited.`,
          code: "IMMUTABILITY",
          details: { message: "Invoice immutability enforced" },
        },
        { status: 400 }
      )
    }

    const businessId = existingInvoice.business_id

    // If updating items, recalculate taxes
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

      const shouldApplyTaxes = apply_taxes !== undefined ? apply_taxes : existingInvoice.apply_taxes !== false

      // Determine effective date: use sent_at if invoice has been sent, otherwise use issue_date
      // When updating a draft that becomes sent, we'll use the new sent_at timestamp
      const effectiveDate = existingInvoice.sent_at 
        ? existingInvoice.sent_at 
        : (issue_date || existingInvoice.issue_date || new Date().toISOString().split('T')[0])

      // Get business country for tax calculation
      const { data: business } = await supabase
        .from("businesses")
        .select("address_country")
        .eq("id", businessId)
        .single()

      const jurisdiction = business?.address_country || 'GH'
      const taxEngineCode = getTaxEngineCode(jurisdiction)
      let baseSubtotal: number
      let invoiceTotal: number
      let legacyTaxAmounts: ReturnType<typeof getLegacyTaxAmounts>
      let taxCalculationResult: ReturnType<typeof calculateTaxes> | null = null

      if (shouldApplyTaxes) {
        // Calculate taxes using shared tax engine (tax-inclusive mode)
        taxCalculationResult = calculateTaxes(
          lineItems,
          business?.address_country,
          effectiveDate,
          true // tax-inclusive pricing
        )

        baseSubtotal = taxCalculationResult.subtotal_excl_tax
        invoiceTotal = taxCalculationResult.total_incl_tax
        legacyTaxAmounts = getLegacyTaxAmounts(taxCalculationResult)
        
        // Derive legacy Ghana tax columns from tax_lines
        // CRITICAL: Only derive Ghana taxes if country is GH
        const countryCode = normalizeCountry(business.address_country)
        const isGhana = countryCode === "GH"
        const legacyGhanaTaxes = isGhana
          ? deriveLegacyGhanaTaxAmounts(taxCalculationResult.taxLines)
          : { nhil: 0, getfund: 0, covid: 0, vat: 0 }
        
        // Store generic tax columns (source of truth)
        updateData.tax_lines = taxResultToJSONB(taxCalculationResult)
        updateData.tax_engine_code = taxEngineCode
        updateData.tax_engine_effective_from = effectiveDate
        updateData.tax_jurisdiction = jurisdiction
        
        // Store legacy columns (derived from tax_lines for backward compatibility)
        // CRITICAL: Only populate nhil/getfund/covid for GH businesses
        updateData.subtotal = baseSubtotal
        updateData.nhil = isGhana ? Math.round(legacyGhanaTaxes.nhil * 100) / 100 : 0
        updateData.getfund = isGhana ? Math.round(legacyGhanaTaxes.getfund * 100) / 100 : 0
        updateData.covid = isGhana ? Math.round(legacyGhanaTaxes.covid * 100) / 100 : 0
        updateData.vat = Math.round(legacyGhanaTaxes.vat * 100) / 100 // VAT may exist for other countries
        updateData.total_tax = legacyTaxAmounts.totalTax
        updateData.total = invoiceTotal
      } else {
        // No taxes applied
        const subtotal = lineItems.reduce((sum: number, item: any) => {
          const lineTotal = item.quantity * item.unit_price
          const discount = item.discount_amount || 0
          return sum + lineTotal - discount
        }, 0)

        baseSubtotal = subtotal
        invoiceTotal = subtotal
        legacyTaxAmounts = {
          nhil: 0,
          getfund: 0,
          covid: 0,
          vat: 0,
          totalTax: 0,
          grandTotal: subtotal,
        }
        
        // Clear tax columns when taxes are disabled
        updateData.tax_lines = null
        updateData.tax_engine_code = null
        updateData.tax_engine_effective_from = null
        updateData.tax_jurisdiction = null
        updateData.subtotal = baseSubtotal
        updateData.nhil = 0
        updateData.getfund = 0
        updateData.covid = 0
        updateData.vat = 0
        updateData.total_tax = 0
        updateData.total = invoiceTotal
      }
    }

    // Update invoice fields
    if (customer_id !== undefined) updateData.customer_id = customer_id
    
    // Invoice number is system-controlled - reject manual changes
    // If invoice was created from an order, invoice number is NEVER editable
    if (invoice_number) {
      // Check if invoice was created from an order
      const { data: invoiceWithSource } = await supabase
        .from("invoices")
        .select("source_type, source_id")
        .eq("id", invoiceId)
        .single()
      
      if (invoiceWithSource?.source_type === "order") {
        return NextResponse.json(
          { error: "Invoice numbers cannot be changed for invoices created from orders. Invoice numbers are system-generated and sequential.", code: "VALIDATION" },
          { status: 400 }
        )
      }
      
      // If invoice is draft and invoice_number is being provided, ignore it (system will assign on issue)
      if (existingInvoice.status !== "draft") {
        // If invoice is already issued, prevent any invoice number changes
        return NextResponse.json(
          { error: "Invoice numbers cannot be changed after the invoice is issued.", code: "VALIDATION" },
          { status: 400 }
        )
      }
      // For drafts, ignore the provided invoice_number - it will be assigned by system when status changes to "sent"
      console.warn("Manual invoice_number change ignored for draft invoice - system will assign when issued")
    }
    
    // INVARIANT 6: Assign invoice number when status changes from draft to sent
    // status = 'sent' ⇒ invoice_number MUST exist
    // AR contract guard: draft invoices should never already have invoice_number.
    if (status === "sent" && existingInvoice.status === "draft" && existingInvoice.invoice_number) {
      return NextResponse.json(
        { error: "Draft invoice has an unexpected invoice number. Cannot set status to 'sent' until data is corrected.", code: "VALIDATION" },
        { status: 400 }
      )
    }

    if (status === "sent" && existingInvoice.status === "draft" && !existingInvoice.invoice_number) {
      const { data: invoiceNumData } = await supabase.rpc("generate_invoice_number_with_settings", {
        business_uuid: existingInvoice.business_id,
      })
      if (invoiceNumData) {
        updateData.invoice_number = invoiceNumData
      } else {
        // INVARIANT 6: Fail loudly if invoice_number cannot be generated for sent status
        return NextResponse.json(
          { error: "Failed to generate invoice number. Cannot set status to 'sent' without invoice number.", code: "GENERATE_NUMBER_FAILED" },
          { status: 500 }
        )
      }
    }
    
    // INVARIANT 6: Validate sent invoices have invoice_number
    if (status === "sent" && !updateData.invoice_number && !existingInvoice.invoice_number) {
      return NextResponse.json(
        { error: "Invoice number is required for sent invoices. Cannot set status to 'sent' without invoice number.", code: "VALIDATION" },
        { status: 400 }
      )
    }

    // If status is changing to "sent", set sent_at timestamp (this is the tax effective date)
    if (status === "sent" && existingInvoice.status !== "sent") {
      updateData.sent_at = new Date().toISOString()
      // Note: When status changes to "sent", sent_at becomes the tax effective date
      // If items are being updated at the same time, tax recalculation should use this new sent_at date
    }
    
    if (issue_date) updateData.issue_date = issue_date
    if (due_date !== undefined) updateData.due_date = due_date
    if (payment_terms !== undefined) updateData.payment_terms = payment_terms
    if (notes !== undefined) updateData.notes = notes
    if (footer_message !== undefined) updateData.footer_message = footer_message
    if (apply_taxes !== undefined) updateData.apply_taxes = apply_taxes
    if (status) {
      updateData.status = status
      if (status === "sent" && !existingInvoice.sent_at) {
        updateData.sent_at = new Date().toISOString()
      }
      if (status === "paid" && !existingInvoice.paid_at) {
        updateData.paid_at = new Date().toISOString()
      }
    }

    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .update(updateData)
      .eq("id", invoiceId)
      .select()
      .single()

    if (invoiceError) {
      console.error("Error updating invoice:", invoiceError)
      return NextResponse.json(
        {
          error: "Invoice could not be updated. Please check all fields and try again.",
          code: invoiceError.code,
          details: { message: invoiceError.message },
        },
        { status: 500 }
      )
    }

    // Update items if provided
    if (items && items.length > 0) {
      // Delete existing items
      await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId)

      // product_service_id must reference products_services(id); invalid ids set to null
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
          invoice_id: invoiceId,
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
        console.error("Error updating invoice items:", itemsError)
        return NextResponse.json(
          {
            error: "Failed to update invoice line items.",
            code: itemsError.code,
            details: { message: itemsError.message },
          },
          { status: 500 }
        )
      }
    }

    // INVARIANT 6: Validate sent invoices have invoice_number (reload to ensure backend truth)
    let finalInvoice = invoice
    if (invoice.status === "sent" && !invoice.invoice_number) {
      // Reload from database to get latest state
      const { data: reloadedInvoice } = await supabase
        .from("invoices")
        .select("*")
        .eq("id", invoiceId)
        .single()
      
      if (reloadedInvoice && reloadedInvoice.status === "sent" && !reloadedInvoice.invoice_number) {
        return NextResponse.json(
          { error: "Invoice number is required for sent invoices. Status cannot be 'sent' without invoice_number.", code: "INVOICE_NUMBER_REQUIRED" },
          { status: 500 }
        )
      }
      
      if (reloadedInvoice) {
        finalInvoice = reloadedInvoice
      }
    }

    // Log audit entry
    await createAuditLog({
      businessId: businessId,
      userId: user?.id || null,
      actionType: "invoice.updated",
      entityType: "invoice",
      entityId: finalInvoice.id,
      oldValues: existingInvoice,
      newValues: finalInvoice,
      request,
    })

    return NextResponse.json({
      success: true,
      invoiceId: finalInvoice.id,
      invoice: finalInvoice,
    })
  } catch (error: any) {
    console.error("Error updating invoice:", error)
    return NextResponse.json(
      {
        error: "Invoice could not be updated. Please check all fields and try again.",
        code: "INTERNAL_ERROR",
        details: error?.message ?? (typeof error === "string" ? error : "Internal server error"),
      },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle Next.js 16 params (can be Promise)
    const resolvedParams = await Promise.resolve(params)
    const invoiceId = resolvedParams.id

    if (!invoiceId) {
      return NextResponse.json(
        { error: "Invoice ID is required" },
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

    const { data: existingInvoice } = await supabase
      .from("invoices")
      .select("id, status, business_id")
      .eq("id", invoiceId)
      .eq("business_id", business.id)
      .single()

    if (!existingInvoice) {
      return NextResponse.json(
        { error: "Invoice not found" },
        { status: 404 }
      )
    }

    // Only allow deletion of draft invoices (soft delete)
    if (existingInvoice.status !== "draft") {
      return NextResponse.json(
        { error: "Only draft invoices can be deleted" },
        { status: 400 }
      )
    }

    // Posted invoices cannot be deleted, even if status is draft.
    const { data: journalEntry, error: journalEntryError } = await supabase
      .from("journal_entries")
      .select("id")
      .eq("business_id", business.id)
      .eq("reference_type", "invoice")
      .eq("reference_id", invoiceId)
      .limit(1)
      .maybeSingle()

    if (journalEntryError) {
      console.error("Error checking journal entries:", journalEntryError)
      return NextResponse.json(
        { error: "Failed to verify invoice posting state" },
        { status: 500 }
      )
    }

    if (journalEntry) {
      return NextResponse.json(
        { error: "Posted invoices cannot be deleted" },
        { status: 400 }
      )
    }

    // Hard delete child items first (safe even if DB already cascades).
    const { error: deleteItemsError } = await supabase
      .from("invoice_items")
      .delete()
      .eq("invoice_id", invoiceId)

    if (deleteItemsError) {
      console.error("Error deleting invoice items:", deleteItemsError)
      return NextResponse.json(
        { error: deleteItemsError.message },
        { status: 500 }
      )
    }

    // Hard delete invoice (scoped to session business).
    const { error } = await supabase
      .from("invoices")
      .delete()
      .eq("id", invoiceId)
      .eq("business_id", business.id)

    if (error) {
      console.error("Error deleting invoice:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // Log audit entry
    try {
      if (business) {
        await createAuditLog({
          businessId: business.id,
          userId: user?.id || null,
          actionType: "invoice.deleted",
          entityType: "invoice",
          entityId: invoiceId,
          oldValues: existingInvoice,
          newValues: null,
          request,
          description: `Invoice ${invoiceId} deleted`,
        })
      }
    } catch (auditError) {
      console.error("Error logging audit:", auditError)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error deleting invoice:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
