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
      .select("address_country")
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

    const { period_start_date, period_end_date } = body

    if (!period_start_date || !period_end_date) {
      return NextResponse.json({ error: "Missing period dates" }, { status: 400 })
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

    // SOURCE OF TRUTH: Ledger only via extract_tax_return_from_ledger RPC
    // Reads accounts 2100 (VAT), 2110 (NHIL), 2120 (GETFund), 2130 (COVID pre-2026)
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
      account_code: string
      opening_balance: number
      period_debits: number
      period_credits: number
      closing_balance: number
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

    const missingAccounts: string[] = []
    if (!rows.some((r) => r.tax_code === "VAT")) missingAccounts.push("2100 (VAT)")
    if (!rows.some((r) => r.tax_code === "NHIL")) missingAccounts.push("2110 (NHIL)")
    if (!rows.some((r) => r.tax_code === "GETFund")) missingAccounts.push("2120 (GETFund)")
    // COVID levy (2130) is optional post-2026 — only warn if no rows at all
    if (rows.length === 0) missingAccounts.push("2130 (COVID)")

    const calculation = calculateVatReturnTotals({
      rows,
      periodEndDate: period_end_date,
      ...taxableBaseInputs(bases),
    })

    const dataQualityException = vatTaxableBaseException({
      totalOutputVat: calculation.total_output_vat,
      totalInputVat: calculation.total_input_vat,
      standardRatedSales: calculation.total_standard_rated_sales,
      standardRatedPurchases: calculation.total_standard_rated_purchases,
      taxableBasesComplete: calculation.taxable_bases_complete,
    })

    const responseBody: Record<string, unknown> = {
      calculation,
      taxable_bases: bases,
      ledger_source: true,
    }

    if (dataQualityException) {
      responseBody.data_quality_exception = dataQualityException
    }

    const warnings = [...calculation.warnings, ...bases.warnings]
    if (missingAccounts.length > 0) {
      warnings.push(
        `The following tax control accounts were not found in the ledger for this period: ${missingAccounts.join(", ")}. ` +
          `All values for those accounts default to zero. ` +
          `Verify that the chart of accounts includes these accounts and that invoices/bills have been posted.`
      )
      console.warn("[VAT Calculate] Missing tax accounts:", missingAccounts, {
        business_id: businessId,
        period_start_date,
        period_end_date,
      })
    }

    if (warnings.length > 0) {
      responseBody.warnings = warnings
    }

    return NextResponse.json(responseBody)
  } catch (error: any) {
    console.error("Error calculating VAT return:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
