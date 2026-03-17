import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { getGhanaLegacyView, sumTaxLines } from "@/lib/taxes/readTaxLines"

export async function GET(request: NextRequest) {
  // HARD GUARD: Block execution - This report uses operational tables instead of ledger
  return NextResponse.json(
    {
      code: "LEDGER_ONLY_REPORT_REQUIRED",
      error: "This report has been deprecated. Use accounting reports.",
    },
    { status: 410 }
  )

  // BLOCKED: All code below is unreachable
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const ctx = await resolveAccountingContext({ supabase, userId: user!.id, searchParams, source: "api" })
    if ("error" in ctx) {
      return NextResponse.json(
        { error: (ctx as { error: string }).error, error_code: "CLIENT_REQUIRED" },
        { status: 400 }
      )
    }
    const business = { id: (ctx as { businessId: string }).businessId }

    // CRITICAL: Load business country and validate
    const { data: businessData } = await supabase
      .from("businesses")
      .select("address_country")
      .eq("id", business.id)
      .single()

    if (!businessData?.address_country) {
      return NextResponse.json(
        { 
          error: "Business country is required. Please set your business country in Business Profile settings.",
          unsupported: true
        },
        { status: 400 }
      )
    }

    const countryCode = normalizeCountry(businessData!.address_country)
    const isGhana = countryCode === "GH"

    const { searchParams: queryParams } = new URL(request.url)
    
    // TRACK B1: LEGACY ROUTE GUARD - This route reads from operational tables (invoices, expenses, bills, sales, credit_notes)
    // Require explicit opt-in via ?legacy_ok=1 to prevent accidental usage
    const legacyOk = queryParams.get("legacy_ok")
    if (legacyOk !== "1") {
      return NextResponse.json(
        {
          error: "This report is deprecated. Use accounting reports.",
          deprecated: true,
          canonical_alternative: "/api/accounting/exports/vat",
        },
        { status: 410 }
      )
    }

    const startDate = queryParams.get("start_date")
    const endDate = queryParams.get("end_date")

    // Get invoice taxes (output tax)
    // CRITICAL: Only query Ghana tax columns (nhil, getfund, covid) for GH businesses
    // For non-GH, these columns will be 0 (enforced by Batch 1)
    // INVARIANT 1: Exclude drafts - drafts never affect Financial Reports
    let invoiceQuery = supabase
      .from("invoices")
      .select("nhil, getfund, covid, vat, total_tax_amount, status, issue_date")
      .eq("business_id", business.id)
      .neq("status", "draft")
      .is("deleted_at", null)

    if (startDate) {
      invoiceQuery = invoiceQuery.gte("issue_date", startDate)
    }

    if (endDate) {
      invoiceQuery = invoiceQuery.lte("issue_date", endDate)
    }

    const { data: invoices, error: invoiceError } = await invoiceQuery

    if (invoiceError) {
      console.error("Error fetching invoices for tax summary:", invoiceError)
    }

    // Get expense taxes (input tax - can be claimed back)
    let expenseQuery = supabase
      .from("expenses")
      .select("nhil, getfund, covid, vat, date")
      .eq("business_id", business.id)
      .is("deleted_at", null)

    if (startDate) {
      expenseQuery = expenseQuery.gte("date", startDate)
    }

    if (endDate) {
      expenseQuery = expenseQuery.lte("date", endDate)
    }

    const { data: expenses, error: expenseError } = await expenseQuery

    if (expenseError) {
      console.error("Error fetching expenses for tax summary:", expenseError)
    }

    // Get bill taxes (input tax - can be claimed back)
    let billsQuery = supabase
      .from("bills")
      .select("nhil, getfund, covid, vat, issue_date")
      .eq("business_id", business.id)
      .is("deleted_at", null)

    if (startDate) {
      billsQuery = billsQuery.gte("issue_date", startDate)
    }

    if (endDate) {
      billsQuery = billsQuery.lte("issue_date", endDate)
    }

    const { data: bills, error: billsError } = await billsQuery

    if (billsError) {
      console.error("Error fetching bills for tax summary:", billsError)
    }

    // Get Retail sales taxes (output tax) - derive from tax_lines JSONB
    // CRITICAL: Only include paid sales (exclude refunded sales)
    let salesQuery = supabase
      .from("sales")
      .select("tax_lines, total_tax, created_at, payment_status")
      .eq("business_id", business.id)
      .eq("payment_status", "paid") // Only paid sales (exclude refunded)
      .is("deleted_at", null)

    if (startDate) {
      salesQuery = salesQuery.gte("created_at", startDate)
    }

    if (endDate) {
      salesQuery = salesQuery.lte("created_at", endDate)
    }

    const { data: sales, error: salesError } = await salesQuery

    if (salesError) {
      console.error("Error fetching sales for tax summary:", salesError)
    }

    // Get applied credit notes for these invoices
    const invoiceIds = invoices?.map((inv: any) => inv.id) || []
    let creditNotes: any[] = []
    
    if (invoiceIds.length > 0) {
      let creditQuery = supabase
        .from("credit_notes")
        .select("nhil, getfund, covid, vat, total_tax, date, invoice_id")
        .in("invoice_id", invoiceIds)
        .eq("status", "applied")
        .is("deleted_at", null)
      
      if (startDate) {
        creditQuery = creditQuery.gte("date", startDate)
      }
      if (endDate) {
        creditQuery = creditQuery.lte("date", endDate)
      }
      
      const { data: creditNotesData } = await creditQuery
      creditNotes = creditNotesData || []
    }

    // Calculate credit note tax reductions
    const creditNhil = isGhana ? creditNotes.reduce((sum, cn) => sum + Number(cn.nhil || 0), 0) : 0
    const creditGetfund = isGhana ? creditNotes.reduce((sum, cn) => sum + Number(cn.getfund || 0), 0) : 0
    const creditCovid = isGhana ? creditNotes.reduce((sum, cn) => sum + Number(cn.covid || 0), 0) : 0
    const creditVat = creditNotes.reduce((sum, cn) => sum + Number(cn.vat || 0), 0)
    const creditTotalTax = creditNotes.reduce((sum, cn) => sum + Number(cn.total_tax || 0), 0)

    // Calculate Retail sales tax totals (output tax) - derive from tax_lines JSONB
    // All new sales have tax_lines populated (Commit A)
    let salesNhil = 0
    let salesGetfund = 0
    let salesCovid = 0
    let salesVat = 0
    let salesTotalTax = 0

    const salesFiltered = sales ?? []
    if (salesFiltered.length > 0) {
      for (const sale of salesFiltered) {
        // Use canonical helper to extract tax amounts from tax_lines (source of truth)
        const { vat, nhil, getfund, covid } = getGhanaLegacyView(sale.tax_lines)
        salesNhil += nhil
        salesGetfund += getfund
        salesCovid += covid
        salesVat += vat
        // Use total_tax from sale if available, otherwise sum from tax_lines
        const saleTotalTax = sale.total_tax ?? (sale.tax_lines ? sumTaxLines(sale.tax_lines) : 0)
        salesTotalTax += saleTotalTax
      }
    }

    // Calculate invoice tax totals (output tax) - subtract credit notes
    // CRITICAL: Exclude draft invoices - drafts are NOT financial documents
    const nonDraftInvoices = (invoices || []).filter((inv: any) => inv.status !== "draft")
    // CRITICAL: Only aggregate Ghana tax columns for GH businesses
    const invoiceNhil = isGhana ? (nonDraftInvoices.reduce((sum, inv) => sum + Number(inv.nhil || 0), 0) || 0) : 0
    const invoiceGetfund = isGhana ? (nonDraftInvoices.reduce((sum, inv) => sum + Number(inv.getfund || 0), 0) || 0) : 0
    const invoiceCovid = isGhana ? (nonDraftInvoices.reduce((sum, inv) => sum + Number(inv.covid || 0), 0) || 0) : 0
    const invoiceVat = nonDraftInvoices.reduce((sum, inv) => sum + Number(inv.vat || 0), 0) || 0
    const invoiceTotalTax = nonDraftInvoices.reduce((sum, inv) => sum + Number(inv.total_tax_amount || 0), 0) || 0

    // Total output tax = invoices + sales - credit notes
    const nhilTotal = isGhana ? (invoiceNhil + salesNhil - creditNhil) : 0
    const getfundTotal = isGhana ? (invoiceGetfund + salesGetfund - creditGetfund) : 0
    const covidTotal = isGhana ? (invoiceCovid + salesCovid - creditCovid) : 0
    const vatTotal = (invoiceVat + salesVat) - creditVat
    const totalTax = (invoiceTotalTax + salesTotalTax) - creditTotalTax

    // Calculate expense tax totals (input tax)
    // CRITICAL: Only aggregate Ghana tax columns for GH businesses
    const expenseNhil = isGhana ? (expenses?.reduce((sum, exp) => sum + Number(exp.nhil || 0), 0) || 0) : 0
    const expenseGetfund = isGhana ? (expenses?.reduce((sum, exp) => sum + Number(exp.getfund || 0), 0) || 0) : 0
    const expenseCovid = isGhana ? (expenses?.reduce((sum, exp) => sum + Number(exp.covid || 0), 0) || 0) : 0
    const expenseVat = expenses?.reduce((sum, exp) => sum + Number(exp.vat || 0), 0) || 0

    // Calculate bill tax totals (input tax)
    // CRITICAL: Only aggregate Ghana tax columns for GH businesses
    const billNhil = isGhana ? (bills?.reduce((sum, bill) => sum + Number(bill.nhil || 0), 0) || 0) : 0
    const billGetfund = isGhana ? (bills?.reduce((sum, bill) => sum + Number(bill.getfund || 0), 0) || 0) : 0
    const billCovid = isGhana ? (bills?.reduce((sum, bill) => sum + Number(bill.covid || 0), 0) || 0) : 0
    const billVat = bills?.reduce((sum, bill) => sum + Number(bill.vat || 0), 0) || 0

    // Total input tax = expenses + bills
    const totalInputNhil = expenseNhil + billNhil
    const totalInputGetfund = expenseGetfund + billGetfund
    const totalInputCovid = expenseCovid + billCovid
    const totalInputVat = expenseVat + billVat
    const totalInputTax = totalInputNhil + totalInputGetfund + totalInputCovid + totalInputVat

    // Only count paid invoices for tax liability
    // Sales are already filtered to payment_status="paid" in query, so all sales in results are paid
    // CRITICAL: Draft invoices already excluded above, now filter to paid only
    const paidInvoices = nonDraftInvoices.filter(inv => inv.status === "paid") || []
    const invoiceNhilPaid = isGhana ? paidInvoices.reduce((sum, inv) => sum + Number(inv.nhil || 0), 0) : 0
    const invoiceGetfundPaid = isGhana ? paidInvoices.reduce((sum, inv) => sum + Number(inv.getfund || 0), 0) : 0
    const invoiceCovidPaid = isGhana ? paidInvoices.reduce((sum, inv) => sum + Number(inv.covid || 0), 0) : 0
    const invoiceVatPaid = paidInvoices.reduce((sum, inv) => sum + Number(inv.vat || 0), 0)
    const invoiceTotalTaxPaid = paidInvoices.reduce((sum, inv) => sum + Number(inv.total_tax_amount || 0), 0)

    // Sales are already filtered to paid only, so sales totals = paid totals
    const nhilPaid = isGhana ? (invoiceNhilPaid + salesNhil) : 0
    const getfundPaid = isGhana ? (invoiceGetfundPaid + salesGetfund) : 0
    const covidPaid = isGhana ? (invoiceCovidPaid + salesCovid) : 0
    const vatPaid = invoiceVatPaid + salesVat
    const totalTaxPaid = invoiceTotalTaxPaid + salesTotalTax

    // Net tax payable = Output tax - Input tax
    const netNhil = nhilTotal - totalInputNhil
    const netGetfund = getfundTotal - totalInputGetfund
    const netCovid = covidTotal - totalInputCovid
    const netVat = vatTotal - totalInputVat
    const netTax = totalTax - totalInputTax

    // CRITICAL: Return Ghana structure for GH, generic structure for non-GH
    if (isGhana) {
      return NextResponse.json({
        summary: {
          outputTax: {
            nhil: Math.round(nhilTotal * 100) / 100,
            getfund: Math.round(getfundTotal * 100) / 100,
            covid: Math.round(covidTotal * 100) / 100,
            vat: Math.round(vatTotal * 100) / 100,
            total: Math.round(totalTax * 100) / 100,
          },
          creditNotes: {
            nhil: Math.round(creditNhil * 100) / 100,
            getfund: Math.round(creditGetfund * 100) / 100,
            covid: Math.round(creditCovid * 100) / 100,
            vat: Math.round(creditVat * 100) / 100,
            total: Math.round(creditTotalTax * 100) / 100,
          },
          inputTax: {
            nhil: Math.round(totalInputNhil * 100) / 100,
            getfund: Math.round(totalInputGetfund * 100) / 100,
            covid: Math.round(totalInputCovid * 100) / 100,
            vat: Math.round(totalInputVat * 100) / 100,
            total: Math.round(totalInputTax * 100) / 100,
            fromExpenses: {
              nhil: Math.round(expenseNhil * 100) / 100,
              getfund: Math.round(expenseGetfund * 100) / 100,
              covid: Math.round(expenseCovid * 100) / 100,
              vat: Math.round(expenseVat * 100) / 100,
            },
            fromBills: {
              nhil: Math.round(billNhil * 100) / 100,
              getfund: Math.round(billGetfund * 100) / 100,
              covid: Math.round(billCovid * 100) / 100,
              vat: Math.round(billVat * 100) / 100,
            },
          },
          netTax: {
            nhil: Math.round(netNhil * 100) / 100,
            getfund: Math.round(netGetfund * 100) / 100,
            covid: Math.round(netCovid * 100) / 100,
            vat: Math.round(netVat * 100) / 100,
            total: Math.round(netTax * 100) / 100,
          },
          paid: {
            nhil: Math.round(nhilPaid * 100) / 100,
            getfund: Math.round(getfundPaid * 100) / 100,
            covid: Math.round(covidPaid * 100) / 100,
            vat: Math.round(vatPaid * 100) / 100,
            total: Math.round(totalTaxPaid * 100) / 100,
          },
          pending: {
            nhil: Math.round((nhilTotal - nhilPaid) * 100) / 100,
            getfund: Math.round((getfundTotal - getfundPaid) * 100) / 100,
            covid: Math.round((covidTotal - covidPaid) * 100) / 100,
            vat: Math.round((vatTotal - vatPaid) * 100) / 100,
            total: Math.round((totalTax - totalTaxPaid) * 100) / 100,
          },
        },
      })
    } else {
      // Non-GH: Return generic tax structure (VAT only)
      return NextResponse.json({
        summary: {
          outputTax: {
            vat: Math.round(vatTotal * 100) / 100,
            total: Math.round(totalTax * 100) / 100,
          },
          creditNotes: {
            vat: Math.round(creditVat * 100) / 100,
            total: Math.round(creditTotalTax * 100) / 100,
          },
          inputTax: {
            vat: Math.round(totalInputVat * 100) / 100,
            total: Math.round(totalInputTax * 100) / 100,
            fromExpenses: {
              vat: Math.round(expenseVat * 100) / 100,
            },
            fromBills: {
              vat: Math.round(billVat * 100) / 100,
            },
          },
          netTax: {
            vat: Math.round(netVat * 100) / 100,
            total: Math.round(netTax * 100) / 100,
          },
          paid: {
            vat: Math.round(vatPaid * 100) / 100,
            total: Math.round(totalTaxPaid * 100) / 100,
          },
          pending: {
            vat: Math.round((vatTotal - vatPaid) * 100) / 100,
            total: Math.round((totalTax - totalTaxPaid) * 100) / 100,
          },
        },
        country: countryCode,
        note: "Tax summary for non-Ghana businesses shows VAT only. Ghana tax structure (NHIL, GETFund) is not applicable.",
      })
    }
  } catch (error: any) {
    console.error("Error in tax summary:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

