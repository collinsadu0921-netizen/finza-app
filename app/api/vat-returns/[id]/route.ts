import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { normalizeCountry } from "@/lib/payments/eligibility"
import {
  enforceServiceWorkspaceAccess,
  enforceServiceWorkspaceWriteAccess,
} from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import { vatPaymentState } from "@/lib/vat/vatReturnPayment"
import { createAuditLog } from "@/lib/auditLog"
import { calculateVatReturnTotals } from "@/lib/vat/vatReturnCalculation"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    const { data: assetAccounts } = await supabase
      .from("accounts")
      .select("id,code,name,type,sub_type")
      .eq("business_id", vatReturn.business_id)
      .eq("type", "asset")
      .is("deleted_at", null)
      .order("code", { ascending: true })

    const paymentAccounts = (assetAccounts || [])
      .filter((account) => {
        const subType = String(account.sub_type || "").toLowerCase()
        const code = String(account.code || "")
        return (
          ["cash", "bank", "momo", "mobile_money"].includes(subType) ||
          ["1000", "1010", "1020"].includes(code)
        )
      })
      .map((account) => ({
        id: account.id,
        code: account.code,
        name: account.name,
        sub_type: account.sub_type,
      }))

    return NextResponse.json({
      vatReturn: {
        ...vatReturn,
        payment_state: vatPaymentState(vatReturn),
      },
      sourceData,
      paymentAccounts,
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
  { params }: { params: Promise<{ id: string }> }
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
      .select("*")
      .eq("id", returnId)
      .is("deleted_at", null)
      .maybeSingle()

    if (loadErr || !existingReturn) {
      return NextResponse.json(
        { error: "VAT return not found" },
        { status: 404 }
      )
    }

    const putAccessDenied = await enforceServiceWorkspaceWriteAccess({
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

    if (status === "paid" && existingReturn.status !== "paid") {
      return NextResponse.json(
        {
          error: "VAT_PAYMENT_REQUIRED",
          message:
            "VAT filings can only be marked paid through the Record payment action, which posts and links a payment journal.",
        },
        { status: 409 }
      )
    }

    // Status transitions are intentionally monotonic. Paid filings cannot be
    // reopened through the ordinary API; corrections require a separate,
    // auditable administrative workflow.
    const allowedStatusTransitions: Record<string, string[]> = {
      draft: ["submitted"],
      submitted: ["paid"],
      paid: [],
    }
    if (status && status !== existingReturn.status) {
      const allowed = allowedStatusTransitions[existingReturn.status] || []
      if (!allowed.includes(status)) {
        return NextResponse.json(
          {
            error: "VAT_STATUS_TRANSITION_INVALID",
            code: "VAT_STATUS_TRANSITION_INVALID",
            message: `VAT filing cannot move from ${existingReturn.status} to ${status}.`,
            current_status: existingReturn.status,
            requested_status: status,
          },
          { status: 409 }
        )
      }
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
    }
    if (input_adjustment !== undefined && existingReturn.status === "draft") {
      updateData.input_adjustment = Number(input_adjustment)
    }
    if (adjustment_reason !== undefined && existingReturn.status === "draft") {
      updateData.adjustment_reason = adjustment_reason?.trim() || null
    }
    if (submission_date !== undefined) updateData.submission_date = submission_date || null
    if (notes !== undefined) updateData.notes = notes?.trim() || null

    // Draft tax totals and net VAT are derived from the same shared
    // regime-aware calculation used by /calculate and /create. Do not trust
    // client-submitted total/net fields as the accounting authority.
    if (existingReturn.status === "draft") {
      const effective = (key: string): number => {
        if (updateData[key] !== undefined) return Number(updateData[key] || 0)
        return Number((existingReturn as Record<string, unknown>)[key] || 0)
      }

      const calculation = calculateVatReturnTotals({
        rows: [
          {
            tax_code: "VAT",
            period_credits: effective("total_output_vat"),
            period_debits: effective("total_input_vat"),
          },
          {
            tax_code: "NHIL",
            period_credits: effective("total_output_nhil"),
            period_debits: effective("total_input_nhil"),
          },
          {
            tax_code: "GETFund",
            period_credits: effective("total_output_getfund"),
            period_debits: effective("total_input_getfund"),
          },
          {
            tax_code: "COVID",
            period_credits: effective("total_output_covid"),
            period_debits: effective("total_input_covid"),
          },
        ],
        periodEndDate: String(existingReturn.period_end_date || ""),
        outputAdjustment: effective("output_adjustment"),
        inputAdjustment: effective("input_adjustment"),
      })

      updateData.total_output_tax = calculation.total_output_tax
      updateData.total_input_tax = calculation.total_input_tax
      updateData.net_vat_payable = calculation.net_vat_payable
      updateData.net_vat_refund = calculation.net_vat_refund
    }

    if (status === "submitted" && !existingReturn.submission_date) {
      updateData.submission_date = new Date().toISOString().split("T")[0]
    }

    const { data: vatReturn, error } = await supabase
      .from("vat_returns")
      .update(updateData)
      .eq("id", returnId)
      .select()
      .single()

    if (error) {
      console.error("Error updating VAT return:", error)
      const message = String(error.message || "")
      if (message.includes("VAT_RETURN_STATUS_TRANSITION_INVALID")) {
        return NextResponse.json(
          {
            error: "VAT_STATUS_TRANSITION_INVALID",
            code: "VAT_STATUS_TRANSITION_INVALID",
            message,
          },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    if (status && status !== existingReturn.status) {
      await createAuditLog({
        businessId: existingReturn.business_id,
        userId: user?.id || null,
        actionType: "vat_return.status_changed",
        entityType: "vat_return",
        entityId: returnId,
        oldValues: { status: existingReturn.status },
        newValues: { status },
        description: `VAT filing status changed from ${existingReturn.status} to ${status}`,
        request,
      })
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
