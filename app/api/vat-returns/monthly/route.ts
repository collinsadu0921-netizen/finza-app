import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { resolveProfessionalVatBusinessId } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import { resolveMonthlyVatNet } from "@/lib/vat/monthlyVat"

export type LedgerLine = {
  id: string
  date: string
  journal_entry_id: string
  description: string | null
  source_type: string | null
  reference: string | null
  reference_type?: string | null
  reference_id?: string | null
  tax_code: string
  debit: number
  credit: number
}

export type MonthlyVatReturn = {
  month: string
  output_nhil: number
  output_getfund: number
  output_covid: number
  output_vat: number
  input_nhil: number
  input_getfund: number
  input_covid: number
  input_vat: number
  net_vat: number
  entries: LedgerLine[]
}

// Tax account codes → human-readable tax code
const TAX_ACCOUNT_MAP: Record<string, string> = {
  "2100": "VAT",
  "2110": "NHIL",
  "2120": "GETFund",
  "2130": "COVID",
}

function money(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { searchParams } = new URL(request.url)
    const urlBusinessId = (searchParams.get("business_id") ?? searchParams.get("businessId"))?.trim() ?? null

    const resolved = await resolveProfessionalVatBusinessId(supabase, user?.id, urlBusinessId)
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
          error: `Monthly VAT returns are not available for country ${countryCode}. Ghana VAT return structure (NHIL, GETFund, COVID, VAT) is only supported for Ghana businesses.`,
          unsupported: true,
          country: countryCode,
        },
        { status: 400 }
      )
    }

    // Fetch the four tax control accounts for this business
    const { data: taxAccounts, error: accountsError } = await supabase
      .from("accounts")
      .select("id, code")
      .eq("business_id", businessId)
      .in("code", ["2100", "2110", "2120", "2130"])
      .is("deleted_at", null)

    if (accountsError) {
      console.error("Error fetching tax accounts:", accountsError)
      return NextResponse.json({ error: accountsError.message }, { status: 500 })
    }

    if (!taxAccounts || taxAccounts.length === 0) {
      return NextResponse.json({ monthlyReturns: [], grandTotalNetVat: 0 })
    }

    const accountIds = taxAccounts.map((a) => a.id)
    // Map from account UUID → tax code label
    const accountIdToTaxCode: Record<string, string> = {}
    for (const acc of taxAccounts) {
      accountIdToTaxCode[acc.id] = TAX_ACCOUNT_MAP[acc.code] || acc.code
    }

    // SOURCE OF TRUTH: Query all journal_entry_lines on tax accounts
    // journal_entries has reference_type + reference_id (no "reference" column)
    const { data: rawLines, error: linesError } = await supabase
      .from("journal_entry_lines")
      .select(
        `id, debit, credit, description, account_id,
         journal_entries!inner(id, date, description, reference_type, reference_id, source_type)`
      )
      .in("account_id", accountIds)
      .order("date", { referencedTable: "journal_entries", ascending: true })

    if (linesError) {
      console.error("Error fetching ledger lines:", linesError)
      return NextResponse.json({ error: linesError.message }, { status: 500 })
    }

    // Group lines by month (YYYY-MM)
    const byMonth: Record<
      string,
      {
        output_vat: number; input_vat: number
        output_nhil: number; input_nhil: number
        output_getfund: number; input_getfund: number
        output_covid: number; input_covid: number
        entries: LedgerLine[]
      }
    > = {}

    for (const line of rawLines || []) {
      const je = (line as any).journal_entries
      const date: string = je.date
      const month = date.substring(0, 7) // YYYY-MM

      // Skip COVID lines for 2026+
      const taxCode = accountIdToTaxCode[line.account_id]
      if (taxCode === "COVID" && date >= "2026-01-01") continue

      if (!byMonth[month]) {
        byMonth[month] = {
          output_vat: 0, input_vat: 0,
          output_nhil: 0, input_nhil: 0,
          output_getfund: 0, input_getfund: 0,
          output_covid: 0, input_covid: 0,
          entries: [],
        }
      }

      const credit = Number(line.credit || 0)
      const debit  = Number(line.debit  || 0)

      if (taxCode === "VAT")      { byMonth[month].output_vat     += credit; byMonth[month].input_vat     += debit }
      if (taxCode === "NHIL")     { byMonth[month].output_nhil    += credit; byMonth[month].input_nhil    += debit }
      if (taxCode === "GETFund")  { byMonth[month].output_getfund += credit; byMonth[month].input_getfund += debit }
      if (taxCode === "COVID")    { byMonth[month].output_covid   += credit; byMonth[month].input_covid   += debit }

      const refType = je.reference_type ?? null
      const refId = je.reference_id ?? null
      const reference = refType && refId ? `${refType}:${refId}` : refType || null
      byMonth[month].entries.push({
        id:               line.id,
        date,
        journal_entry_id: je.id,
        description:      line.description || je.description || null,
        source_type:      je.source_type || null,
        reference,
        reference_type:   refType,
        reference_id:      refId,
        tax_code:         taxCode,
        debit,
        credit,
      })
    }

    // A filed return's stored amounts are immutable and authoritative. For
    // months without a filed return, use the canonical regime-aware
    // calculation so the ledger preview matches the filing preview.
    const { data: filedReturns, error: filedReturnsError } = await supabase
      .from("vat_returns")
      .select(
        "id,period_start_date,status,total_output_nhil,total_output_getfund,total_output_covid,total_output_vat,total_input_nhil,total_input_getfund,total_input_covid,total_input_vat,net_vat_payable,net_vat_refund"
      )
      .eq("business_id", businessId)
      .is("deleted_at", null)

    if (filedReturnsError) {
      console.error("Error fetching filed VAT returns:", filedReturnsError)
      return NextResponse.json({ error: filedReturnsError.message }, { status: 500 })
    }

    const filedByMonth = new Map<string, any>()
    for (const row of filedReturns || []) {
      const month = String(row.period_start_date || "").slice(0, 7)
      if (month) filedByMonth.set(month, row)
    }

    const sortedMonths = Array.from(
      new Set([...Object.keys(byMonth), ...filedByMonth.keys()])
    ).sort()

    const emptyMonth = {
      output_vat: 0,
      input_vat: 0,
      output_nhil: 0,
      input_nhil: 0,
      output_getfund: 0,
      input_getfund: 0,
      output_covid: 0,
      input_covid: 0,
      entries: [] as LedgerLine[],
    }

    const monthlyReturns: MonthlyVatReturn[] = sortedMonths.map((month) => {
      const m = byMonth[month] ?? emptyMonth
      const filed = filedByMonth.get(month)
      const netVat = resolveMonthlyVatNet({ month, ledger: m, filed })

      if (filed) {
        return {
          month,
          output_nhil: money(filed.total_output_nhil),
          output_getfund: money(filed.total_output_getfund),
          output_covid: money(filed.total_output_covid),
          output_vat: money(filed.total_output_vat),
          input_nhil: money(filed.total_input_nhil),
          input_getfund: money(filed.total_input_getfund),
          input_covid: money(filed.total_input_covid),
          input_vat: money(filed.total_input_vat),
          net_vat: netVat,
          entries: m.entries,
        }
      }

      return {
        month,
        output_nhil: money(m.output_nhil),
        output_getfund: money(m.output_getfund),
        output_covid: money(m.output_covid),
        output_vat: money(m.output_vat),
        input_nhil: money(m.input_nhil),
        input_getfund: money(m.input_getfund),
        input_covid: money(m.input_covid),
        input_vat: money(m.input_vat),
        net_vat: netVat,
        entries: m.entries,
      }
    })

    const grandTotalNetVat = monthlyReturns.reduce((sum: number, m: MonthlyVatReturn) => sum + m.net_vat, 0)

    return NextResponse.json({
      monthlyReturns,
      grandTotalNetVat: Math.round(grandTotalNetVat * 100) / 100,
      ledger_source: true,
    })
  } catch (error: any) {
    console.error("Error calculating monthly VAT returns:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
