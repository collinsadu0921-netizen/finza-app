import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { normalizeCountry } from "@/lib/payments/eligibility"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    let business: { id: string } | null = null
    if (user) {
      business = await getCurrentBusiness(supabase, user.id)
    }

    if (!business) {
      const { data: firstBusiness } = await supabase
        .from("businesses")
        .select("id")
        .limit(1)
        .single()
      if (firstBusiness) {
        business = firstBusiness
      }
    }

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const { data: businessData } = await supabase
      .from("businesses")
      .select("address_country")
      .eq("id", business.id)
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

    const body = await request.json()
    const { period_start_date, period_end_date } = body

    if (!period_start_date || !period_end_date) {
      return NextResponse.json({ error: "Missing period dates" }, { status: 400 })
    }

    // SOURCE OF TRUTH: Ledger only via extract_tax_return_from_ledger RPC
    // Reads accounts 2100 (VAT), 2110 (NHIL), 2120 (GETFund), 2130 (COVID pre-2026)
    const { data: ledgerData, error: rpcError } = await supabase.rpc(
      "extract_tax_return_from_ledger",
      {
        p_business_id: business.id,
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

    const vatRow     = rows.find((r) => r.tax_code === "VAT")
    const nhilRow    = rows.find((r) => r.tax_code === "NHIL")
    const getfundRow = rows.find((r) => r.tax_code === "GETFund")
    const covidRow   = rows.find((r) => r.tax_code === "COVID")

    // Detect missing tax control accounts (silent zeros are dangerous — warn the caller)
    const missingAccounts: string[] = []
    if (!vatRow)     missingAccounts.push("2100 (VAT)")
    if (!nhilRow)    missingAccounts.push("2110 (NHIL)")
    if (!getfundRow) missingAccounts.push("2120 (GETFund)")
    // COVID levy (2130) is optional post-2026 — only warn if no rows at all
    if (rows.length === 0) missingAccounts.push("2130 (COVID)")

    const vat      = vatRow     || { period_credits: 0, period_debits: 0, closing_balance: 0 }
    const nhil     = nhilRow    || { period_credits: 0, period_debits: 0 }
    const getfund  = getfundRow || { period_credits: 0, period_debits: 0 }
    const covid    = covidRow   || { period_credits: 0, period_debits: 0 }

    // period_credits on tax liability accounts = output tax (charged to customers)
    // period_debits  on tax liability accounts = input tax reductions + payments/reversals
    const total_output_vat     = Number(vat.period_credits)
    const total_output_nhil    = Number(nhil.period_credits)
    const total_output_getfund = Number(getfund.period_credits)
    const total_output_covid   = Number(covid.period_credits)
    const total_output_tax     = total_output_vat + total_output_nhil + total_output_getfund + total_output_covid

    const total_input_vat     = Number(vat.period_debits)
    const total_input_nhil    = Number(nhil.period_debits)
    const total_input_getfund = Number(getfund.period_debits)
    const total_input_covid   = Number(covid.period_debits)
    const total_input_tax     = total_input_vat + total_input_nhil + total_input_getfund + total_input_covid

    // Net tax payable for the period (output credits minus input debits)
    // Act 1151 (VAT Act 2025, effective Jan 1 2026): NHIL and GETFund are now claimable
    // as input tax credits — include all three levies in the net calculation post-2026.
    // For historical periods (pre-2026), only VAT was claimable so use VAT-only net.
    const periodIsPost2026 = new Date(period_end_date) >= new Date("2026-01-01")
    const periodNetVat = periodIsPost2026
      ? (total_output_vat + total_output_nhil + total_output_getfund)
        - (total_input_vat + total_input_nhil + total_input_getfund)
      : total_output_vat - total_input_vat
    const net_vat_payable = Math.max(periodNetVat, 0)
    const net_vat_refund  = Math.max(-periodNetVat, 0)

    // Derive taxable bases from VAT at 15% (Ghana standard rate)
    const VAT_RATE = 0.15
    const total_taxable_sales     = total_output_vat > 0 ? Math.round((total_output_vat / VAT_RATE) * 100) / 100 : 0
    const total_taxable_purchases = total_input_vat  > 0 ? Math.round((total_input_vat  / VAT_RATE) * 100) / 100 : 0

    const responseBody: Record<string, unknown> = {
      calculation: {
        total_taxable_sales:     Math.round(total_taxable_sales     * 100) / 100,
        total_output_nhil:       Math.round(total_output_nhil       * 100) / 100,
        total_output_getfund:    Math.round(total_output_getfund    * 100) / 100,
        total_output_covid:      Math.round(total_output_covid      * 100) / 100,
        total_output_vat:        Math.round(total_output_vat        * 100) / 100,
        total_output_tax:        Math.round(total_output_tax        * 100) / 100,
        total_taxable_purchases: Math.round(total_taxable_purchases * 100) / 100,
        total_input_nhil:        Math.round(total_input_nhil        * 100) / 100,
        total_input_getfund:     Math.round(total_input_getfund     * 100) / 100,
        total_input_covid:       Math.round(total_input_covid       * 100) / 100,
        total_input_vat:         Math.round(total_input_vat         * 100) / 100,
        total_input_tax:         Math.round(total_input_tax         * 100) / 100,
        net_vat_payable:         Math.round(net_vat_payable         * 100) / 100,
        net_vat_refund:          Math.round(net_vat_refund          * 100) / 100,
      },
      ledger_source: true,
    }

    if (missingAccounts.length > 0) {
      responseBody.warnings = [
        `The following tax control accounts were not found in the ledger for this period: ${missingAccounts.join(", ")}. ` +
        `All values for those accounts default to zero. ` +
        `Verify that the chart of accounts includes these accounts and that invoices/bills have been posted.`,
      ]
      console.warn("[VAT Calculate] Missing tax accounts:", missingAccounts, { business_id: business.id, period_start_date, period_end_date })
    }

    return NextResponse.json(responseBody)
  } catch (error: any) {
    console.error("Error calculating VAT return:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
