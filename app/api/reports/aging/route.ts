import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"

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
    const { searchParams } = new URL(request.url)
    
    // TRACK B1: LEGACY ROUTE GUARD - This route reads from operational tables (invoices, payments)
    // Require explicit opt-in via ?legacy_ok=1 to prevent accidental usage
    const legacyOk = searchParams.get("legacy_ok")
    if (legacyOk !== "1") {
      return NextResponse.json(
        {
          error: "This report is deprecated. Use accounting reports.",
          deprecated: true,
          canonical_alternative: "/api/accounting/reports/general-ledger",
        },
        { status: 410 }
      )
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT - Keep login check only
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    // AUTH DISABLED FOR DEVELOPMENT - Bypass business ownership check
    // Business context: use resolveAccountingContext or business_id param
    // if (!business) {
    //   return NextResponse.json({ error: "Business not found" }, { status: 404 })
    // }

    const businessId = searchParams.get("business_id") // Allow filtering by business_id if provided

    // Get all unpaid invoices
    // CRITICAL: Exclude draft invoices - drafts are NOT financial documents and cannot be outstanding
    // Only issued/sent/partially_paid invoices can be outstanding
    let invoicesQuery = supabase
      .from("invoices")
      .select(
        `
        id,
        invoice_number,
        issue_date,
        due_date,
        total,
        status,
        customers (
          id,
          name
        )
      `
      )
      // AUTH DISABLED FOR DEVELOPMENT - Removed business_id filter, add optional filter
      // .eq("business_id", business.id)
      .in("status", ["sent", "partially_paid", "overdue"])
      .neq("status", "draft") // Explicitly exclude drafts
      .neq("status", "paid") // Explicitly exclude paid
      .is("deleted_at", null)

    if (businessId) {
      invoicesQuery = invoicesQuery.eq("business_id", businessId)
    }

    const { data: invoices, error: invoicesError } = await invoicesQuery

    if (invoicesError) {
      console.error("Error fetching invoices:", invoicesError)
      return NextResponse.json(
        { error: invoicesError.message },
        { status: 500 }
      )
    }

    // Get all payments
    const invoiceIds = (invoices || []).map((inv: any) => inv.id)
    let payments: any[] = []

    if (invoiceIds.length > 0) {
      const { data: paymentsData, error: paymentsError } = await supabase
        .from("payments")
        .select("invoice_id, amount")
        .in("invoice_id", invoiceIds)
        .is("deleted_at", null)

      if (paymentsError) {
        console.error("Error fetching payments:", paymentsError)
      } else {
        payments = paymentsData || []
      }
    }

    // LEDGER-BASED: Calculate aging buckets using journal_entry.entry_date
    // Get AR account (account_code '1200') to find invoice-related entries
    const { data: arAccount } = await supabase
      .from("accounts")
      .select("id")
      .eq("business_id", businessId || "")
      .eq("code", "1200")
      .is("deleted_at", null)
      .single()

    const today = new Date()
    const agingData: Record<string, any[]> = {
      "0-30": [],
      "31-60": [],
      "61-90": [],
      "90+": [],
    }

    const customerAging: Record<string, {
      customer: any
      "0-30": number
      "31-60": number
      "61-90": number
      "90+": number
      total: number
    }> = {}

    if (arAccount) {
      // Get AR journal entries for invoices, grouped by invoice (reference_id)
      const { data: arLines } = await supabase
        .from("journal_entry_lines")
        .select(
          `
          debit,
          credit,
          journal_entries!inner (
            id,
            date,
            business_id,
            reference_type,
            reference_id
          )
        `
        )
        .eq("account_id", arAccount.id)
        .eq("journal_entries.business_id", businessId || "")
        .eq("journal_entries.reference_type", "invoice")

      if (arLines) {
        // Group by invoice_id and calculate balance per invoice
        const invoiceBalances = new Map<string, { balance: number; entryDate: Date }>()
        
        for (const line of arLines) {
          const invoiceId = line.journal_entries?.reference_id
          if (!invoiceId) continue

          const entryDate = new Date(line.journal_entries?.date || today)
          const amount = Number(line.debit || 0) - Number(line.credit || 0) // AR is asset: debit - credit

          const existing = invoiceBalances.get(invoiceId) || { balance: 0, entryDate }
          existing.balance += amount
          // Use earliest entry date for aging calculation
          if (entryDate < existing.entryDate) {
            existing.entryDate = entryDate
          }
          invoiceBalances.set(invoiceId, existing)
        }

        // Get invoice details for invoices with outstanding balances
        const invoiceIds = Array.from(invoiceBalances.keys())
        if (invoiceIds.length > 0) {
          const { data: invoiceDetails } = await supabase
            .from("invoices")
            .select(
              `
              id,
              invoice_number,
              issue_date,
              due_date,
              total,
              status,
              customers (
                id,
                name
              )
            `
            )
            .in("id", invoiceIds)
            .in("status", ["sent", "partially_paid", "overdue"])
            .neq("status", "draft")
            .neq("status", "paid")
            .is("deleted_at", null)

          if (invoiceDetails) {
            for (const invoice of invoiceDetails) {
              const invoiceBalance = invoiceBalances.get(invoice.id)
              if (!invoiceBalance || invoiceBalance.balance <= 0) continue

              // LEDGER-BASED: Use journal_entry.entry_date for aging, NOT invoice.issue_date or due_date
              const entryDate = invoiceBalance.entryDate
              const daysPastDue = Math.floor((today.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24))

              let bucket: string
              if (daysPastDue <= 30) {
                bucket = "0-30"
              } else if (daysPastDue <= 60) {
                bucket = "31-60"
              } else if (daysPastDue <= 90) {
                bucket = "61-90"
              } else {
                bucket = "90+"
              }

              const agingEntry = {
                ...invoice,
                balance: invoiceBalance.balance,
                daysPastDue,
              }

              agingData[bucket].push(agingEntry)

              // Group by customer
              const customerId = invoice.customers?.id || "unknown"
              const customerName = invoice.customers?.name || "Unknown"

              if (!customerAging[customerId]) {
                customerAging[customerId] = {
                  customer: { id: customerId, name: customerName },
                  "0-30": 0,
                  "31-60": 0,
                  "61-90": 0,
                  "90+": 0,
                  total: 0,
                }
              }

              customerAging[customerId][bucket as keyof typeof customerAging[string]] += invoiceBalance.balance
              customerAging[customerId].total += invoiceBalance.balance
            }
          }
        }
      }
    }

    // Calculate totals
    const totals = {
      "0-30": agingData["0-30"].reduce((sum, inv) => sum + inv.balance, 0),
      "31-60": agingData["31-60"].reduce((sum, inv) => sum + inv.balance, 0),
      "61-90": agingData["61-90"].reduce((sum, inv) => sum + inv.balance, 0),
      "90+": agingData["90+"].reduce((sum, inv) => sum + inv.balance, 0),
      total: Object.values(agingData).reduce((sum, bucket) => 
        sum + bucket.reduce((s, inv) => s + inv.balance, 0), 0
      ),
    }

    return NextResponse.json({
      agingData,
      customerAging: Object.values(customerAging).sort((a, b) => b.total - a.total),
      totals,
    })
  } catch (error: any) {
    console.error("Error generating aging report:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

