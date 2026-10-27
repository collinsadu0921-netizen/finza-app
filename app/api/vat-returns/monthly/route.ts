import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { resolveProfessionalVatBusinessId } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import { repairMojibake } from "@/lib/text/repairMojibake"

export type LedgerLine = {
  id: string
  date: string
  journal_entry_id: string
  description: string | null
  source_type: string | null
  reference: string | null
  reference_type?: string | null
  reference_id?: string | null
  /** Human-readable invoice/bill/credit-note reference resolved from the source row. */
  reference_label?: string | null
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

    // Resolve human document numbers for ledger references (never show raw UUIDs).
    const REFERENCE_QUERY_TYPES = new Set([
      "invoice",
      "bill",
      "credit_note",
      "expense",
      "payment",
      "payroll",
      "asset",
    ])
    const referencedIds = new Map<string, Set<string>>()
    for (const line of rawLines || []) {
      const je = (line as any).journal_entries
      const refType = je?.reference_type as string | null | undefined
      const refId = je?.reference_id as string | null | undefined
      if (!refType || !refId || !REFERENCE_QUERY_TYPES.has(refType)) continue
      if (!referencedIds.has(refType)) referencedIds.set(refType, new Set())
      referencedIds.get(refType)!.add(refId)
    }

    const idsFor = (type: string) => Array.from(referencedIds.get(type) ?? [])
    const fetchReferenceRows = async (table: string, ids: string[], select: string) => {
      if (ids.length === 0) return [] as any[]
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .eq("business_id", businessId)
        .in("id", ids)
      if (error) {
        console.error(`Error resolving ${table} references:`, error)
        return [] as any[]
      }
      return (data ?? []) as any[]
    }

    const [invoiceRows, billRows, creditNoteRows, expenseRows, paymentRows, payrollRows, assetRows] =
      await Promise.all([
        fetchReferenceRows("invoices", idsFor("invoice"), "id, invoice_number"),
        fetchReferenceRows("bills", idsFor("bill"), "id, bill_number, supplier_name"),
        fetchReferenceRows("credit_notes", idsFor("credit_note"), "id, credit_number"),
        fetchReferenceRows("expenses", idsFor("expense"), "id, supplier"),
        fetchReferenceRows("payments", idsFor("payment"), "id, reference, invoice_id"),
        fetchReferenceRows("payroll_runs", idsFor("payroll"), "id, payroll_month"),
        fetchReferenceRows("assets", idsFor("asset"), "id, asset_code"),
      ])

    const invoiceNumberById = new Map<string, string>()
    for (const row of invoiceRows) {
      if (row.id && row.invoice_number) invoiceNumberById.set(row.id, String(row.invoice_number))
    }

    const referenceLabels = new Map<string, string>()
    const rememberReference = (type: string, id: string, label: string | null | undefined) => {
      const clean = label ? repairMojibake(String(label)).trim() : ""
      if (clean) referenceLabels.set(`${type}:${id}`, clean)
    }

    for (const row of invoiceRows) {
      rememberReference("invoice", row.id, row.invoice_number ? `Invoice ${row.invoice_number}` : null)
    }
    for (const row of billRows) {
      const supplier = row.supplier_name ? ` · ${row.supplier_name}` : ""
      rememberReference("bill", row.id, row.bill_number ? `Bill ${row.bill_number}${supplier}` : null)
    }
    for (const row of creditNoteRows) {
      rememberReference(
        "credit_note",
        row.id,
        row.credit_number ? `Credit note ${row.credit_number}` : null
      )
    }
    for (const row of expenseRows) {
      rememberReference("expense", row.id, row.supplier ? `Expense · ${row.supplier}` : "Expense")
    }
    for (const row of paymentRows) {
      const detail = row.reference || invoiceNumberById.get(row.invoice_id) || null
      rememberReference("payment", row.id, detail ? `Payment · ${detail}` : "Payment")
    }
    for (const row of payrollRows) {
      rememberReference("payroll", row.id, row.payroll_month ? `Payroll · ${row.payroll_month}` : "Payroll")
    }
    for (const row of assetRows) {
      rememberReference("asset", row.id, row.asset_code ? `Asset ${row.asset_code}` : "Asset")
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

      const refType = je.reference_type ? repairMojibake(je.reference_type) : null
      const refId = je.reference_id ?? null
      const reference = refType && refId ? `${refType}:${refId}` : refType || null
      const referenceLabel =
        refType && refId ? referenceLabels.get(`${refType}:${refId}`) ?? null : null
      const description = repairMojibake(line.description || je.description || "").trim() || null
      byMonth[month].entries.push({
        id:               line.id,
        date,
        journal_entry_id: je.id,
        description,
        source_type:      je.source_type ? repairMojibake(je.source_type) : null,
        reference,
        reference_type:   refType,
        reference_id:      refId,
        reference_label:   referenceLabel,
        tax_code:         taxCode,
        debit,
        credit,
      })
    }

    const sortedMonths = Object.keys(byMonth).sort()

    const monthlyReturns: MonthlyVatReturn[] = sortedMonths.map((month) => {
      const m = byMonth[month]
      const net_vat = m.output_vat - m.input_vat
      return {
        month,
        output_nhil:    Math.round(m.output_nhil    * 100) / 100,
        output_getfund: Math.round(m.output_getfund * 100) / 100,
        output_covid:   Math.round(m.output_covid   * 100) / 100,
        output_vat:     Math.round(m.output_vat     * 100) / 100,
        input_nhil:     Math.round(m.input_nhil     * 100) / 100,
        input_getfund:  Math.round(m.input_getfund  * 100) / 100,
        input_covid:    Math.round(m.input_covid    * 100) / 100,
        input_vat:      Math.round(m.input_vat      * 100) / 100,
        net_vat:        Math.round(net_vat          * 100) / 100,
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
