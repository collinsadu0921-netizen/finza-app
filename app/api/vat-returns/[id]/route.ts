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
import {
  parseVatTaxableBases,
  taxableBaseInputs,
  vatTaxableBaseException,
} from "@/lib/vat/taxableBases"

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
    if (submission_date !== undefined) updateData.submission_date = submission_date || null
    if (notes !== undefined) updateData.notes = notes?.trim() || null

    // Draft tax figures are always recomputed from the ledger and persisted
    // transaction evidence. Client-submitted total/net fields are ignored.
    let calculation: ReturnType<typeof calculateVatReturnTotals> | null = null
    let bases: ReturnType<typeof parseVatTaxableBases> | null = null

    if (existingReturn.status === "draft") {
      const requestedOutputAdjustment =
        output_adjustment !== undefined
          ? Number(output_adjustment)
          : Number(existingReturn.output_adjustment || 0)
      const requestedInputAdjustment =
        input_adjustment !== undefined
          ? Number(input_adjustment)
          : Number(existingReturn.input_adjustment || 0)
      const requestedReason =
        adjustment_reason !== undefined
          ? adjustment_reason?.trim() || null
          : existingReturn.adjustment_reason

      if (
        (Math.abs(requestedOutputAdjustment) > 0.009 ||
          Math.abs(requestedInputAdjustment) > 0.009) &&
        !requestedReason
      ) {
        return NextResponse.json(
          {
            error:
              "An adjustment reason is required when output or input adjustments are non-zero.",
            code: "VAT_ADJUSTMENT_REASON_REQUIRED",
          },
          { status: 400 }
        )
      }

      updateData.output_adjustment = requestedOutputAdjustment
      updateData.input_adjustment = requestedInputAdjustment
      updateData.adjustment_reason = requestedReason

      const { data: ledgerData, error: ledgerError } = await supabase.rpc(
        "extract_tax_return_from_ledger",
        {
          p_business_id: existingReturn.business_id,
          p_start_date: existingReturn.period_start_date,
          p_end_date: existingReturn.period_end_date,
        }
      )
      if (ledgerError) {
        console.error("Error recalculating VAT ledger figures:", ledgerError)
        return NextResponse.json(
          { error: "Could not recalculate VAT figures from the ledger." },
          { status: 500 }
        )
      }

      const { data: basesData, error: basesError } = await supabase.rpc(
        "extract_vat_taxable_bases",
        {
          p_business_id: existingReturn.business_id,
          p_start_date: existingReturn.period_start_date,
          p_end_date: existingReturn.period_end_date,
        }
      )
      if (basesError) {
        console.error("Error recalculating VAT taxable bases:", basesError)
        return NextResponse.json(
          {
            error:
              "Taxable sales and purchases could not be determined from transaction evidence.",
            code: "VAT_TAXABLE_BASE_UNAVAILABLE",
          },
          { status: 500 }
        )
      }

      bases = parseVatTaxableBases(basesData)
      calculation = calculateVatReturnTotals({
        rows: ledgerData || [],
        periodEndDate: String(existingReturn.period_end_date || ""),
        ...taxableBaseInputs(bases),
        outputAdjustment: requestedOutputAdjustment,
        inputAdjustment: requestedInputAdjustment,
      })

      updateData.total_taxable_sales = calculation.total_taxable_sales
      updateData.total_zero_rated_sales = calculation.total_zero_rated_sales
      updateData.total_exempt_sales = calculation.total_exempt_sales
      updateData.total_output_nhil = calculation.total_output_nhil
      updateData.total_output_getfund = calculation.total_output_getfund
      updateData.total_output_covid = calculation.total_output_covid
      updateData.total_output_vat = calculation.total_output_vat
      updateData.total_output_tax = calculation.total_output_tax
      updateData.total_taxable_purchases = calculation.total_taxable_purchases
      updateData.total_zero_rated_purchases = calculation.total_zero_rated_purchases
      updateData.total_exempt_purchases = calculation.total_exempt_purchases
      updateData.total_input_nhil = calculation.total_input_nhil
      updateData.total_input_getfund = calculation.total_input_getfund
      updateData.total_input_covid = calculation.total_input_covid
      updateData.total_input_vat = calculation.total_input_vat
      updateData.total_input_tax = calculation.total_input_tax
      updateData.net_vat_payable = calculation.net_vat_payable
      updateData.net_vat_refund = calculation.net_vat_refund
    }

    if (status === "submitted" && existingReturn.status !== "submitted") {
      if (!bases || !calculation) {
        return NextResponse.json(
          {
            error: "VAT filing could not be reconciled before submission.",
            code: "VAT_SUBMISSION_RECONCILIATION_REQUIRED",
          },
          { status: 409 }
        )
      }

      const exception = vatTaxableBaseException({
        bases,
        totalOutputVat: calculation.total_output_vat,
        totalInputVat: calculation.total_input_vat,
        standardRatedSales: calculation.total_standard_rated_sales,
        standardRatedPurchases: calculation.total_standard_rated_purchases,
        taxableBasesComplete: calculation.taxable_bases_complete,
      })

      if (exception) {
        return NextResponse.json(
          {
            error: exception.message,
            code: exception.code,
            data_quality_exception: exception,
            warnings: [...calculation.warnings, ...bases.warnings],
          },
          { status: 409 }
        )
      }

      if (!existingReturn.submission_date) {
        updateData.submission_date = new Date().toISOString().split("T")[0]
      }
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
