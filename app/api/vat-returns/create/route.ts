import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { resolveProfessionalVatBusinessId } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

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

    // Check if return already exists for this period
    const { data: existingReturn } = await supabase
      .from("vat_returns")
      .select("id")
      .eq("business_id", businessId)
      .eq("period_start_date", period_start_date)
      .eq("period_end_date", period_end_date)
      .is("deleted_at", null)
      .single()

    if (existingReturn) {
      return NextResponse.json(
        { error: "VAT return already exists for this period" },
        { status: 400 }
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

    const vat     = rows.find((r) => r.tax_code === "VAT")     || { period_credits: 0, period_debits: 0 }
    const nhil    = rows.find((r) => r.tax_code === "NHIL")    || { period_credits: 0, period_debits: 0 }
    const getfund = rows.find((r) => r.tax_code === "GETFund") || { period_credits: 0, period_debits: 0 }
    const covid   = rows.find((r) => r.tax_code === "COVID")   || { period_credits: 0, period_debits: 0 }

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

    const VAT_RATE = 0.15
    const total_taxable_sales     = total_output_vat > 0 ? Math.round((total_output_vat / VAT_RATE) * 100) / 100 : 0
    const total_taxable_purchases = total_input_vat  > 0 ? Math.round((total_input_vat  / VAT_RATE) * 100) / 100 : 0

    const adjustedOutputTax = total_output_tax + Number(output_adjustment || 0)
    const adjustedInputTax  = total_input_tax  + Number(input_adjustment  || 0)
    const netVatPayable = Math.max(adjustedOutputTax - adjustedInputTax, 0)
    const netVatRefund  = Math.max(adjustedInputTax  - adjustedOutputTax, 0)

    // ledger_authority: true — figures sourced exclusively from the immutable ledger
    const { data: vatReturn, error } = await supabase
      .from("vat_returns")
      .insert({
        business_id: businessId,
        period_start_date,
        period_end_date,
        status: "draft",
        ledger_authority: true,
        total_taxable_sales:     Math.round(total_taxable_sales     * 100) / 100,
        total_output_nhil:       Math.round(total_output_nhil       * 100) / 100,
        total_output_getfund:    Math.round(total_output_getfund    * 100) / 100,
        total_output_covid:      Math.round(total_output_covid      * 100) / 100,
        total_output_vat:        Math.round(total_output_vat        * 100) / 100,
        total_output_tax:        Math.round(adjustedOutputTax       * 100) / 100,
        total_taxable_purchases: Math.round(total_taxable_purchases * 100) / 100,
        total_input_nhil:        Math.round(total_input_nhil        * 100) / 100,
        total_input_getfund:     Math.round(total_input_getfund     * 100) / 100,
        total_input_covid:       Math.round(total_input_covid       * 100) / 100,
        total_input_vat:         Math.round(total_input_vat         * 100) / 100,
        total_input_tax:         Math.round(adjustedInputTax        * 100) / 100,
        net_vat_payable:         Math.round(netVatPayable           * 100) / 100,
        net_vat_refund:          Math.round(netVatRefund            * 100) / 100,
        output_adjustment:  Number(output_adjustment || 0),
        input_adjustment:   Number(input_adjustment  || 0),
        adjustment_reason:  adjustment_reason?.trim() || null,
        notes:              notes?.trim() || null,
      })
      .select()
      .single()

    if (error) {
      console.error("Error creating VAT return:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ vatReturn }, { status: 201 })
  } catch (error: any) {
    console.error("Error creating VAT return:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
