import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const returnId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { data: vatReturn, error } = await supabase
      .from("vat_returns")
      .select("*")
      .eq("id", returnId)
      .is("deleted_at", null)
      .maybeSingle()

    if (error || !vatReturn) {
      return NextResponse.json(
        { error: "VAT return not found" },
        { status: 404 }
      )
    }

    const accessDenied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user?.id,
      businessId: vatReturn.business_id,
      minTier: "professional",
    })
    if (accessDenied) return accessDenied

    const { data: businessData } = await supabase
      .from("businesses")
      .select("address_country")
      .eq("id", vatReturn.business_id)
      .single()

    if (!businessData?.address_country) {
      return NextResponse.json(
        {
          error:
            "Business country is required. Please set your business country in Business Profile settings.",
          unsupported: true,
        },
        { status: 400 }
      )
    }

    const countryCode = normalizeCountry(businessData.address_country)
    const isGhana = countryCode === "GH"

    if (!isGhana) {
      return NextResponse.json(
        {
          error: `VAT returns are not available for country ${countryCode}. Ghana VAT return structure (NHIL, GETFund, COVID, VAT) is only supported for Ghana businesses.`,
          unsupported: true,
          country: countryCode,
        },
        { status: 400 }
      )
    }

    // Get source data for export - fetch invoices, expenses, bills, credit notes directly
    let sourceData: any = {
      invoices: [],
      creditNotes: [],
      expenses: [],
      bills: [],
    }

    try {
      // Get invoices
      const { data: invoices } = await supabase
        .from("invoices")
        .select("id, invoice_number, issue_date, subtotal, nhil, getfund, covid, vat, total_tax, apply_taxes")
        .eq("business_id", vatReturn.business_id)
        .in("status", ["paid", "partially_paid"])
        .gte("issue_date", vatReturn.period_start_date)
        .lte("issue_date", vatReturn.period_end_date)
        .is("deleted_at", null)
        .eq("apply_taxes", true)

      // Get credit notes
      const { data: creditNotes } = await supabase
        .from("credit_notes")
        .select("id, credit_number, date, subtotal, nhil, getfund, covid, vat, total_tax")
        .eq("business_id", vatReturn.business_id)
        .eq("status", "applied")
        .gte("date", vatReturn.period_start_date)
        .lte("date", vatReturn.period_end_date)
        .is("deleted_at", null)

      // Get expenses
      const { data: expenses } = await supabase
        .from("expenses")
        .select("id, date, supplier, total, nhil, getfund, covid, vat")
        .eq("business_id", vatReturn.business_id)
        .gte("date", vatReturn.period_start_date)
        .lte("date", vatReturn.period_end_date)
        .is("deleted_at", null)
        .or("nhil.gt.0,getfund.gt.0,covid.gt.0,vat.gt.0")

      // Get bills
      const { data: bills } = await supabase
        .from("bills")
        .select("id, bill_number, issue_date, subtotal, nhil, getfund, covid, vat, total_tax")
        .eq("business_id", vatReturn.business_id)
        .gte("issue_date", vatReturn.period_start_date)
        .lte("issue_date", vatReturn.period_end_date)
        .is("deleted_at", null)

      sourceData = {
        invoices: invoices || [],
        creditNotes: creditNotes || [],
        expenses: expenses || [],
        bills: bills || [],
      }
    } catch (calcError) {
      console.error("Error fetching source data:", calcError)
      // Continue with empty source data
    }

    return NextResponse.json({
      vatReturn,
      sourceData,
    })
  } catch (error: any) {
    console.error("Error fetching VAT return:", error)
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
    const returnId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { data: existingReturn, error: loadErr } = await supabase
      .from("vat_returns")
      .select(
        "business_id, status, total_output_tax, total_input_tax, output_adjustment, input_adjustment, submission_date, payment_date"
      )
      .eq("id", returnId)
      .is("deleted_at", null)
      .maybeSingle()

    if (loadErr || !existingReturn) {
      return NextResponse.json(
        { error: "VAT return not found" },
        { status: 404 }
      )
    }

    const putAccessDenied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user?.id,
      businessId: existingReturn.business_id,
      minTier: "professional",
    })
    if (putAccessDenied) return putAccessDenied

    const body = await request.json()
    const {
      status,
      output_adjustment,
      input_adjustment,
      adjustment_reason,
      submission_date,
      payment_date,
      payment_reference,
      notes,
      // Allow recalculating these fields for draft returns
      total_taxable_sales,
      total_output_nhil,
      total_output_getfund,
      total_output_covid,
      total_output_vat,
      total_output_tax,
      total_taxable_purchases,
      total_input_nhil,
      total_input_getfund,
      total_input_covid,
      total_input_vat,
      total_input_tax,
      net_vat_payable,
      net_vat_refund,
    } = body

    // If submitted, lock the return (only notes editable)
    if (status === "submitted" && existingReturn.status !== "submitted") {
      // Lock the return - no further edits to calculations
    }

    const updateData: any = {}
    if (status) updateData.status = status

    // Allow recalculating all tax fields if status is draft
    if (existingReturn.status === "draft") {
      if (total_taxable_sales !== undefined) updateData.total_taxable_sales = Number(total_taxable_sales)
      if (total_output_nhil !== undefined) updateData.total_output_nhil = Number(total_output_nhil)
      if (total_output_getfund !== undefined) updateData.total_output_getfund = Number(total_output_getfund)
      if (total_output_covid !== undefined) updateData.total_output_covid = Number(total_output_covid)
      if (total_output_vat !== undefined) updateData.total_output_vat = Number(total_output_vat)
      if (total_output_tax !== undefined) updateData.total_output_tax = Number(total_output_tax)
      if (total_taxable_purchases !== undefined) updateData.total_taxable_purchases = Number(total_taxable_purchases)
      if (total_input_nhil !== undefined) updateData.total_input_nhil = Number(total_input_nhil)
      if (total_input_getfund !== undefined) updateData.total_input_getfund = Number(total_input_getfund)
      if (total_input_covid !== undefined) updateData.total_input_covid = Number(total_input_covid)
      if (total_input_vat !== undefined) updateData.total_input_vat = Number(total_input_vat)
      if (total_input_tax !== undefined) updateData.total_input_tax = Number(total_input_tax)
      if (net_vat_payable !== undefined) updateData.net_vat_payable = Number(net_vat_payable)
      if (net_vat_refund !== undefined) updateData.net_vat_refund = Number(net_vat_refund)
    }
    if (output_adjustment !== undefined && existingReturn.status === "draft") {
      updateData.output_adjustment = Number(output_adjustment)
      // Recalculate net VAT with adjustments
      const adjustedOutputTax = existingReturn.total_output_tax + Number(output_adjustment) - (existingReturn.output_adjustment || 0)
      const adjustedInputTax = existingReturn.total_input_tax + Number(input_adjustment || 0) - (existingReturn.input_adjustment || 0)
      updateData.total_output_tax = adjustedOutputTax
      updateData.total_input_tax = adjustedInputTax
      updateData.net_vat_payable = Math.max(adjustedOutputTax - adjustedInputTax, 0)
      updateData.net_vat_refund = Math.max(adjustedInputTax - adjustedOutputTax, 0)
    }
    if (input_adjustment !== undefined && existingReturn.status === "draft") {
      updateData.input_adjustment = Number(input_adjustment)
      // Recalculate net VAT with adjustments
      const adjustedOutputTax = existingReturn.total_output_tax + Number(output_adjustment || 0) - (existingReturn.output_adjustment || 0)
      const adjustedInputTax = existingReturn.total_input_tax + Number(input_adjustment) - (existingReturn.input_adjustment || 0)
      updateData.total_output_tax = adjustedOutputTax
      updateData.total_input_tax = adjustedInputTax
      updateData.net_vat_payable = Math.max(adjustedOutputTax - adjustedInputTax, 0)
      updateData.net_vat_refund = Math.max(adjustedInputTax - adjustedOutputTax, 0)
    }
    if (adjustment_reason !== undefined && existingReturn.status === "draft") {
      updateData.adjustment_reason = adjustment_reason?.trim() || null
    }
    if (submission_date !== undefined) updateData.submission_date = submission_date || null
    if (payment_date !== undefined) updateData.payment_date = payment_date || null
    if (payment_reference !== undefined) updateData.payment_reference = payment_reference?.trim() || null
    if (notes !== undefined) updateData.notes = notes?.trim() || null

    if (status === "submitted" && !existingReturn.submission_date) {
      updateData.submission_date = new Date().toISOString().split("T")[0]
    }

    if (status === "paid" && !existingReturn.payment_date) {
      updateData.payment_date = new Date().toISOString().split("T")[0]
    }

    const { data: vatReturn, error } = await supabase
      .from("vat_returns")
      .update(updateData)
      .eq("id", returnId)
      .select()
      .single()

    if (error) {
      console.error("Error updating VAT return:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ vatReturn })
  } catch (error: any) {
    console.error("Error updating VAT return:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
