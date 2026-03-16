import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    console.log("[estimates.convert] params.id:", id)
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    console.log("[estimates.convert] resolved current business.id:", business?.id ?? null)

    // Fetch estimate
    const { data: estimate, error: estimateError } = await supabase
      .from("estimates")
      .select(`
        id,
        business_id,
        customer_id,
        estimate_number,
        issue_date,
        expiry_date,
        status,
        subtotal,
        subtotal_before_tax,
        nhil_amount,
        getfund_amount,
        covid_amount,
        vat_amount,
        total_tax_amount,
        tax,
        total_amount,
        notes,
        created_at,
        updated_at,
        deleted_at,
        tax_lines,
        tax_jurisdiction,
        tax_engine_code,
        tax_engine_effective_from,
        revision_number,
        supersedes_id
      `)
      .eq("id", id)
      .is("deleted_at", null)
      .single()
    console.log("[estimates.convert] estimate query result:", {
      estimateId: id,
      estimateBusinessId: estimate?.business_id ?? null,
      found: !!estimate,
      error: estimateError?.message ?? null,
      errorCode: estimateError?.code ?? null,
    })

    if (estimateError || !estimate) {
      console.log("[estimates.convert] returning 404: estimate not found", {
        estimateId: id,
        estimateBusinessId: estimate?.business_id ?? null,
        error: estimateError?.message ?? null,
      })
      return NextResponse.json(
        { error: "Estimate not found" },
        { status: 404 }
      )
    }

    // Permission enforcement after estimate fetch:
    // user must be business owner or have membership in business_users.
    const { data: businessRecord, error: businessRecordError } = await supabase
      .from("businesses")
      .select("id, owner_id")
      .eq("id", estimate.business_id)
      .single()

    if (businessRecordError || !businessRecord) {
      return NextResponse.json(
        { error: "Business not found" },
        { status: 404 }
      )
    }

    const isOwner = businessRecord.owner_id === user.id
    let hasMembership = false

    if (!isOwner) {
      const { data: membership, error: membershipError } = await supabase
        .from("business_users")
        .select("business_id")
        .eq("business_id", estimate.business_id)
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .maybeSingle()

      if (!membershipError && membership) {
        hasMembership = true
      }
    }

    if (!isOwner && !hasMembership) {
      return NextResponse.json(
        { error: "Estimate not found" },
        { status: 404 }
      )
    }

    // Check if estimate has already been converted
    if (estimate.converted_to) {
      return NextResponse.json(
        { error: `This estimate has already been converted to ${estimate.converted_to}. An estimate can only be converted once.` },
        { status: 400 }
      )
    }

    // Fetch estimate items - FATAL: abort if fetch fails or returns empty
    const { data: estimateItems, error: itemsError } = await supabase
      .from("estimate_items")
      .select("*")
      .eq("estimate_id", id)
      .order("created_at", { ascending: true })

    if (itemsError) {
      return NextResponse.json(
        { error: `Failed to load estimate items: ${itemsError.message}` },
        { status: 400 }
      )
    }

    if (!estimateItems || estimateItems.length === 0) {
      return NextResponse.json(
        { error: "Cannot convert estimate: estimate must have at least one line item" },
        { status: 400 }
      )
    }

    const customerId = estimate.customer_id ?? null

    // AR contract: draft invoices must not have invoice_number.
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .insert({
        business_id: estimate.business_id,
        customer_id: customerId,
        invoice_number: null,
        issue_date: estimate.issue_date || new Date().toISOString().split("T")[0],
        due_date: estimate.expiry_date || null,
        notes: estimate.notes || null,
        status: "draft",
        apply_taxes: Number(estimate.total_tax_amount ?? 0) > 0,
        subtotal: Number(estimate.subtotal) || 0,
        nhil: Number(estimate.nhil_amount ?? estimate.nhil) || 0,
        getfund: Number(estimate.getfund_amount ?? estimate.getfund) || 0,
        covid: Number(estimate.covid_amount ?? estimate.covid) || 0,
        vat: Number(estimate.vat_amount ?? estimate.vat) || 0,
        total_tax: Number(estimate.total_tax_amount ?? estimate.total_tax) || 0,
        total: Number(estimate.total_amount ?? estimate.total) || 0,
        // Preserve canonical tax metadata so posting can emit tax journal lines.
        tax_lines: estimate.tax_lines ?? null,
        tax_jurisdiction: estimate.tax_jurisdiction ?? null,
        tax_engine_code: estimate.tax_engine_code ?? null,
        tax_engine_effective_from: estimate.tax_engine_effective_from ?? null,
      })
      .select()
      .single()

    if (invoiceError) {
      console.error("Error creating invoice from estimate:", invoiceError)
      return NextResponse.json(
        { error: invoiceError.message },
        { status: 500 }
      )
    }

    // Normalize estimate items (handle both schema versions: qty/unit_price/line_total OR quantity/price/total)
    const normalizedItems = estimateItems.map((item: any) => {
      const product_service_id = item.product_service_id ?? item.product_id ?? null
      const qty = Number(item.qty ?? item.quantity ?? 0)
      const unit_price = Number(item.unit_price ?? item.price ?? 0)
      const line_subtotal = Number(item.line_total ?? item.total ?? 0)
      const discount_amount = Number(item.discount_amount ?? 0)
      const description = item.description || ""

      // Validate required fields
      if (!description.trim()) {
        throw new Error("Estimate item missing description")
      }
      if (qty <= 0) {
        throw new Error("Estimate item quantity must be greater than 0")
      }
      if (unit_price < 0) {
        throw new Error("Estimate item unit price cannot be negative")
      }

      return {
        product_service_id,
        qty,
        unit_price,
        line_subtotal,
        discount_amount,
        description,
      }
    })

    // Create invoice items from normalized estimate items - use ONLY valid invoice_items columns
    const invoiceItems = normalizedItems.map((item) => ({
      invoice_id: invoice.id,
      product_service_id: item.product_service_id,
      description: item.description,
      qty: item.qty,
      unit_price: item.unit_price,
      discount_amount: item.discount_amount,
      line_subtotal: item.line_subtotal,
    }))

    const { error: itemsInsertError } = await supabase
      .from("invoice_items")
      .insert(invoiceItems)

    if (itemsInsertError) {
      console.error("Error creating invoice items:", itemsInsertError)
      // Delete the invoice if items fail
      await supabase.from("invoices").delete().eq("id", invoice.id)
      return NextResponse.json(
        { error: `Failed to create invoice items: ${itemsInsertError.message}` },
        { status: 500 }
      )
    }

    // Update estimate status to "accepted" and mark as converted to invoice
    // This prevents any further conversions from this estimate
    await supabase
      .from("estimates")
      .update({ 
        status: "accepted",
        converted_to: "invoice"
      })
      .eq("id", id)

    return NextResponse.json({
      invoice,
      message: "Estimate converted to invoice successfully",
    })
  } catch (error: any) {
    console.error("Error converting estimate:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
