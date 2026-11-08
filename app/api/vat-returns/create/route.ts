import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { resolveProfessionalVatBusinessId } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import { calculateVatReturnTotals } from "@/lib/vat/vatReturnCalculation"
import { isCalendarMonthPeriod } from "@/lib/vat/vatPeriod"
import {
  parseVatTaxableBases,
  taxableBaseInputs,
  vatTaxableBaseException,
} from "@/lib/vat/taxableBases"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const body = await request.json()
    const explicitBiz =
      typeof body.business_id === "string" ? body.business_id : null

    const resolved = await resolveProfessionalVatBusinessId(
      supabase,
      user?.id,
      explicitBiz
    )
    if (resolved instanceof NextResponse) return resolved
    const { businessId } = resolved

    const { data: businessData } = await supabase
      .from("businesses")
      .select("address_country, vat_scheme")
      .eq("id", businessId)
      .single()

    if (!businessData?.address_country) {
      return NextResponse.json(
        {
          error: "Business country is required. Please set your business country in Business Profile settings.",
          unsupported: true,
        },
        { status: 400 }
      )
    }

    const vatScheme = (businessData as any).vat_scheme || "standard"
    if (vatScheme === "none") {
      return NextResponse.json(
        {
          error: "Your business is not VAT registered. VAT returns are only available for VAT-registered businesses. Update your VAT Registration Status in Business Profile settings if this is incorrect.",
          unsupported: true,
          vat_scheme: "none",
        },
        { status: 400 }
      )
    }
    if (vatScheme === "vfrs") {
      // VFRS was abolished under the Value Added Tax Act, 2025 (Act 1151), effective Jan 1, 2026.
      // All previously VFRS-registered businesses are now on the standard rate.
      // This guard remains for any legacy records not yet migrated.
      return NextResponse.json(
        {
          error: "The VAT Flat Rate Scheme (VFRS) was abolished effective January 1, 2026 under the Value Added Tax Act, 2025 (Act 1151). Your business should now be on the Standard Rate. Please update your VAT Registration Status to 'VAT Registered — Standard Rate' in Business Profile settings.",
          unsupported: true,
          vat_scheme: "vfrs",
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

    const {
      period_start_date,
      period_end_date,
      output_adjustment = 0,
      input_adjustment = 0,
      adjustment_reason,
      notes,
    } = body

    if (!period_start_date || !period_end_date) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    if (!isCalendarMonthPeriod(period_start_date, period_end_date)) {
      return NextResponse.json(
        {
          error:
            "VAT return periods must be full calendar months: start on the first day and end on the last day of the same month.",
          code: "VAT_PERIOD_INVALID",
        },
        { status: 400 }
      )
    }

    // Reject any active return whose period overlaps this one. The database
    // trigger is the concurrency-safe backstop; this check provides a clear
    // API error before doing ledger work.
    const { data: overlappingReturns, error: overlapError } = await supabase
      .from("vat_returns")
      .select("id, period_start_date, period_end_date")
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .lte("period_start_date", period_end_date)
      .gte("period_end_date", period_start_date)
      .limit(1)

    if (overlapError) {
      console.error("Error checking overlapping VAT returns:", overlapError)
      return NextResponse.json({ error: overlapError.message }, { status: 500 })
    }

    if (overlappingReturns && overlappingReturns.length > 0) {
      return NextResponse.json(
        {
          error: "A VAT return already exists for an overlapping period.",
          code: "VAT_RETURN_PERIOD_OVERLAP",
          overlapping_return_id: overlappingReturns[0].id,
        },
        { status: 409 }
      )
    }

    // SOURCE OF TRUTH: Ledger only via extract_tax_return_from_ledger RPC
    const { data: ledgerData, error: rpcError } = await supabase.rpc(
      "extract_tax_return_from_ledger",
      {
        p_business_id: businessId,
        p_start_date: period_start_date,
        p_end_date: period_end_date,
      }
    )

    if (rpcError) {
      console.error("Error calling extract_tax_return_from_ledger:", rpcError)
      return NextResponse.json({ error: rpcError.message }, { status: 500 })
    }

    const rows: Array<{
      tax_code: string
      period_debits: number
      period_credits: number
    }> = ledgerData || []

    // Taxable bases come from persisted tax-line bases and classified retail
    // supplies. They are never derived from VAT / 15%.
    const { data: basesData, error: basesError } = await supabase.rpc(
      "extract_vat_taxable_bases",
      {
        p_business_id: businessId,
        p_start_date: period_start_date,
        p_end_date: period_end_date,
      }
    )

    if (basesError) {
      console.error("Error calling extract_vat_taxable_bases:", basesError)
      return NextResponse.json(
        {
          error:
            "Taxable sales and purchases could not be determined from transaction evidence.",
          code: "VAT_TAXABLE_BASE_UNAVAILABLE",
          details: basesError.message,
        },
        { status: 500 }
      )
    }

    const bases = parseVatTaxableBases(basesData)

    const calculation = calculateVatReturnTotals({
      rows,
      periodEndDate: period_end_date,
      outputAdjustment: output_adjustment,
      inputAdjustment: input_adjustment,
      ...taxableBaseInputs(bases),
    })

    const dataQualityException = vatTaxableBaseException({
      totalOutputVat: calculation.total_output_vat,
      totalInputVat: calculation.total_input_vat,
      standardRatedSales: calculation.total_standard_rated_sales,
      standardRatedPurchases: calculation.total_standard_rated_purchases,
      taxableBasesComplete: calculation.taxable_bases_complete,
    })

    if (dataQualityException) {
      return NextResponse.json(
        {
          error: dataQualityException.message,
          code: dataQualityException.code,
          taxable_bases: bases,
          warnings: [...calculation.warnings, ...bases.warnings],
        },
        { status: 409 }
      )
    }

    // ledger_authority: true — figures sourced exclusively from the immutable ledger
    const { data: vatReturn, error } = await supabase
      .from("vat_returns")
      .insert({
        business_id: businessId,
        period_start_date,
        period_end_date,
        status: "draft",
        ledger_authority: true,
        total_taxable_sales: calculation.total_taxable_sales,
        total_zero_rated_sales: calculation.total_zero_rated_sales,
        total_exempt_sales: calculation.total_exempt_sales,
        total_output_nhil: calculation.total_output_nhil,
        total_output_getfund: calculation.total_output_getfund,
        total_output_covid: calculation.total_output_covid,
        total_output_vat: calculation.total_output_vat,
        total_output_tax: calculation.total_output_tax,
        total_taxable_purchases: calculation.total_taxable_purchases,
        total_zero_rated_purchases: calculation.total_zero_rated_purchases,
        total_exempt_purchases: calculation.total_exempt_purchases,
        total_input_nhil: calculation.total_input_nhil,
        total_input_getfund: calculation.total_input_getfund,
        total_input_covid: calculation.total_input_covid,
        total_input_vat: calculation.total_input_vat,
        total_input_tax: calculation.total_input_tax,
        net_vat_payable: calculation.net_vat_payable,
        net_vat_refund: calculation.net_vat_refund,
        output_adjustment: Number(output_adjustment || 0),
        input_adjustment: Number(input_adjustment || 0),
        adjustment_reason: adjustment_reason?.trim() || null,
        notes: notes?.trim() || null,
      })
      .select()
      .single()

    if (error) {
      console.error("Error creating VAT return:", error)
      const message = String(error.message || "")
      if (message.includes("VAT_RETURN_PERIOD_OVERLAP")) {
        return NextResponse.json(
          {
            error: "A VAT return already exists for an overlapping period.",
            code: "VAT_RETURN_PERIOD_OVERLAP",
          },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const warnings = [...calculation.warnings, ...bases.warnings]
    return NextResponse.json(
      {
        vatReturn,
        taxable_bases: bases,
        ...(warnings.length > 0 ? { warnings } : {}),
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error("Error creating VAT return:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
