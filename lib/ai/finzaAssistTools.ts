import type { SupabaseClient } from "@supabase/supabase-js"
import { runPersistedReceiptOcr } from "@/lib/documents/runPersistedReceiptOcr"
import type { DocumentType } from "@/lib/receipt/receiptOcr"
import { gateAccountingReportRead } from "@/lib/ai/finzaAssistAccountingGate"
import { getProfitAndLossReport, type PnLReportResponse } from "@/lib/accounting/reports/getProfitAndLossReport"
import {
  getBalanceSheetReport,
  type BalanceSheetReportResponse,
} from "@/lib/accounting/reports/getBalanceSheetReport"

/** OpenAI-compatible tool specs for Finza Assist (read-only, business-scoped). */
export const FINZA_ASSIST_TOOL_DEFINITIONS: Array<{
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}> = [
  {
    type: "function",
    function: {
      name: "get_dashboard_summary",
      description:
        "Read-only: monthly customer payments (income), expense records (NOT payroll module), invoice/bill overview. Does NOT include salary or payroll runs — never use this alone to answer how much salary/wages/net pay was paid; call get_payroll_runs_summary for that.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "search_invoices",
      description:
        "Read-only: search invoices by invoice number substring and/or customer name substring. At least one of query or customer_name_contains must be provided. Returns up to 15 matches.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Part of the invoice number to match (optional if customer_name_contains set)" },
          customer_name_contains: {
            type: "string",
            description: "Substring to match against customer display name (optional if query set)",
          },
          limit: { type: "integer", description: "Max results 1–15", minimum: 1, maximum: 15 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_bills",
      description:
        "Read-only: search supplier bills by reference or supplier name context (matches bill fields where available). Returns up to 15 rows.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search text" },
          limit: { type: "integer", minimum: 1, maximum: 15 },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tax_profile",
      description:
        "Read-only: VAT scheme and CIT rate code from the business profile. Use for tax setting questions.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_payroll_runs_summary",
      description:
        "Read-only Finza payroll module: payroll runs by month with gross, net (take-home), PAYE, SSNIT totals and status (draft/approved/locked). Use whenever the user asks about salary paid, wages, staff pay, net pay, payroll, payslips, PAYE/SSNIT from payroll, or payroll for a month/year. Set all_history true for every run on file (no month window). Set include_staff_entries true for per-employee lines (gross, net, PAYE, etc.) inside each run. total_net_salary on a finalized run is the usual answer for 'how much was paid to staff' for that period.",
      parameters: {
        type: "object",
        properties: {
          all_history: {
            type: "boolean",
            description:
              "If true, return all payroll runs for the business (up to server cap); months_back is ignored. Use for lifetime / full history questions.",
          },
          months_back: {
            type: "integer",
            description: "Rolling window in months when all_history is false or omitted (1–120). Default 12.",
            minimum: 1,
            maximum: 120,
          },
          include_staff_entries: {
            type: "boolean",
            description:
              "If true, include each run's payroll_entries with staff name and pay breakdown. Heavier payload; use when the user asks per-person detail, payslip-level figures, or to verify a run line-by-line.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_profit_and_loss_summary",
      description:
        "Read-only ledger P&L for the workspace. Use for profit/loss, revenue vs expenses, and period comparisons. Requires accounting report access. Optional period_start, as_of_date, or start_date+end_date (YYYY-MM-DD) like the Reports UI.",
      parameters: {
        type: "object",
        properties: {
          period_start: { type: "string", description: "Optional accounting period start YYYY-MM-DD" },
          as_of_date: { type: "string", description: "Optional as-of date YYYY-MM-DD to resolve period" },
          start_date: { type: "string", description: "Optional range start (use with end_date)" },
          end_date: { type: "string", description: "Optional range end (use with start_date)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_balance_sheet_summary",
      description:
        "Read-only ledger balance sheet (assets, liabilities, equity). Use for solvency, balances, and whether books balance. Requires accounting report access.",
      parameters: {
        type: "object",
        properties: {
          period_start: { type: "string", description: "Optional period start YYYY-MM-DD" },
          as_of_date: { type: "string", description: "Optional as-of date YYYY-MM-DD" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_invoice_detail",
      description:
        "Read-only: one invoice by id (UUID) with customer name, line summary, totals, status, dates. Use when context includes invoice id or user pasted id.",
      parameters: {
        type: "object",
        properties: {
          invoice_id: { type: "string", description: "Invoice UUID" },
        },
        required: ["invoice_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_open_invoices",
      description:
        "Read-only: unpaid/partial invoices (receivables). Optional overdue_only (past due date, still open). Use for collections, who owes, aging overview.",
      parameters: {
        type: "object",
        properties: {
          overdue_only: { type: "boolean", description: "If true, only invoices past due_date with open status" },
          limit: { type: "integer", minimum: 1, maximum: 25, description: "Max rows (default 15)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_customers",
      description:
        "Read-only: search customers by name or email substring. Returns id, name, email, phone if present.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Substring to match name or email" },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_expense_totals_by_category",
      description:
        "Read-only: sum expense totals by category for a calendar month (operational expenses module, not payroll). Default month is current calendar month on server.",
      parameters: {
        type: "object",
        properties: {
          year_month: {
            type: "string",
            description: "YYYY-MM; omit for current month",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "extract_receipt_ocr",
      description:
        "Read-only receipt OCR: extracts suggested supplier, date, totals, taxes, and line items from a receipt image already stored in Finza (storage path under receipts bucket, or an allowed Supabase storage URL). Same engine as Expense/Bill create. Use when the user asks to read, scan, or extract a receipt they uploaded or when a receipt_path is mentioned. Does not create expenses or bills — suggest Go to: /service/expenses/create or /service/bills to record it.",
      parameters: {
        type: "object",
        properties: {
          receipt_path: {
            type: "string",
            description:
              "Storage path in the receipts bucket (e.g. expenses/{businessId}/{timestamp}.jpg) or an https URL from this project's Supabase storage.",
          },
          document_type: {
            type: "string",
            enum: ["expense", "supplier_bill"],
            description: "Interpret as expense receipt vs supplier bill. Default expense.",
          },
        },
        required: ["receipt_path"],
        additionalProperties: false,
      },
    },
  },
]

const ALLOWED_TOOL_NAMES = new Set(FINZA_ASSIST_TOOL_DEFINITIONS.map((t) => t.function.name))

function localTodayYmd(): string {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

const ASSIST_PNL_TOP_LINES = 5
const ASSIST_BS_TOP_LINES = 4

function summarizePnLForAssist(d: PnLReportResponse): Record<string, unknown> {
  return {
    tool: "get_profit_and_loss_summary",
    period: d.period,
    currency_code: d.currency.code,
    totals: d.totals,
    sections: d.sections.map((s) => ({
      key: s.key,
      label: s.label,
      subtotal: s.subtotal,
      line_count: s.lines.length,
      largest_amount_lines: [...s.lines]
        .sort((a, b) => Math.abs(Number(b.amount) || 0) - Math.abs(Number(a.amount) || 0))
        .slice(0, ASSIST_PNL_TOP_LINES)
        .map((l) => ({
          account_code: l.account_code,
          account_name: l.account_name,
          amount: l.amount,
        })),
    })),
    navigation_hint: "/service/reports/profit-and-loss",
  }
}

function summarizeBSForAssist(d: BalanceSheetReportResponse): Record<string, unknown> {
  return {
    tool: "get_balance_sheet_summary",
    period: d.period,
    as_of_date: d.as_of_date,
    currency_code: d.currency.code,
    totals: d.totals,
    sections: d.sections.map((sec) => ({
      key: sec.key,
      label: sec.label,
      subtotal: sec.subtotal,
      groups: sec.groups.map((g) => ({
        key: g.key,
        label: g.label,
        subtotal: g.subtotal,
        largest_amount_lines: [...g.lines]
          .sort((a, b) => Math.abs(Number(b.amount) || 0) - Math.abs(Number(a.amount) || 0))
          .slice(0, ASSIST_BS_TOP_LINES)
          .map((l) => ({
            account_code: l.account_code,
            account_name: l.account_name,
            amount: l.amount,
          })),
      })),
    })),
    navigation_hint: "/service/reports/balance-sheet",
  }
}

/** Supabase/PostgREST safety: very large businesses still get a bounded response. */
const PAYROLL_RUNS_MAX = 2000
const PAYROLL_ENTRIES_MAX = 15_000
const PAYROLL_RUN_ID_IN_CHUNK = 40

export async function executeFinzaAssistTool(
  supabase: SupabaseClient,
  businessId: string,
  userId: string,
  toolName: string,
  argsJson: string
): Promise<{ ok: true; result: string } | { ok: false; error: string }> {
  if (!ALLOWED_TOOL_NAMES.has(toolName)) {
    return { ok: false, error: "Unknown tool" }
  }

  let args: Record<string, unknown> = {}
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {}
  } catch {
    return { ok: false, error: "Invalid tool arguments JSON" }
  }

  try {
    switch (toolName) {
      case "get_dashboard_summary": {
        const today = localTodayYmd()
        const currentMonth = (() => {
          const now = new Date()
          const start = new Date(now.getFullYear(), now.getMonth(), 1)
          const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
          return { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0] }
        })()

        const openInvoiceStatuses = ["sent", "overdue", "partially_paid", "partial"]

        const [
          paymentsRes,
          expensesRes,
          invoicesRes,
          billsRes,
          overdueHead,
        ] = await Promise.all([
          supabase
            .from("payments")
            .select("amount")
            .eq("business_id", businessId)
            .is("deleted_at", null)
            .gte("date", currentMonth.start)
            .lte("date", currentMonth.end),
          supabase
            .from("expenses")
            .select("total")
            .eq("business_id", businessId)
            .is("deleted_at", null)
            .gte("date", currentMonth.start)
            .lte("date", currentMonth.end),
          supabase
            .from("invoices")
            .select("status, total, due_date")
            .eq("business_id", businessId)
            .is("deleted_at", null),
          supabase
            .from("bills")
            .select("status, total")
            .eq("business_id", businessId)
            .is("deleted_at", null),
          supabase
            .from("invoices")
            .select("id", { count: "exact", head: true })
            .eq("business_id", businessId)
            .is("deleted_at", null)
            .not("due_date", "is", null)
            .lt("due_date", today)
            .in("status", openInvoiceStatuses),
        ])

        const payments = paymentsRes.data ?? []
        const expenses = expensesRes.data ?? []
        const invoices = invoicesRes.data ?? []
        const bills = billsRes.data ?? []

        const incomeMonth = round2(payments.reduce((s, p) => s + (Number((p as { amount?: number }).amount) || 0), 0))
        const expenseMonth = round2(expenses.reduce((s, e) => s + (Number((e as { total?: number }).total) || 0), 0))

        const byStatus: Record<string, number> = {}
        for (const inv of invoices as { status?: string }[]) {
          const st = String(inv.status || "unknown").toLowerCase()
          byStatus[st] = (byStatus[st] || 0) + 1
        }

        const unpaidBillStatuses = new Set([
          "pending",
          "partial",
          "overdue",
          "unpaid",
          "approved",
          "open",
          "partially_paid",
        ])
        let unpaidBillsTotal = 0
        for (const b of bills as Record<string, unknown>[]) {
          const st = String(b.status || "").toLowerCase()
          if (!unpaidBillStatuses.has(st)) continue
          unpaidBillsTotal += Number(b.total) || 0
        }
        unpaidBillsTotal = round2(unpaidBillsTotal)

        const overdueApprox = overdueHead.count ?? 0

        return {
          ok: true,
          result: JSON.stringify({
            tool: "get_dashboard_summary",
            period_month_start: currentMonth.start,
            period_month_end: currentMonth.end,
            total_income_this_month: incomeMonth,
            total_expenses_this_month: expenseMonth,
            net_this_month: round2(incomeMonth - expenseMonth),
            invoice_count_by_status: byStatus,
            overdue_open_invoice_count_approx: overdueApprox,
            unpaid_bills_total_approx: unpaidBillsTotal,
            note: "Overdue count is invoices past due date excluding paid/draft/cancelled (approximation; not net of partial payments).",
          }),
        }
      }

      case "search_invoices": {
        const numQ = String(args.query ?? "").trim().slice(0, 80)
        const custQ = String(args.customer_name_contains ?? "").trim().slice(0, 80)
        if (!numQ && !custQ) {
          return { ok: false, error: "Provide query (invoice number) and/or customer_name_contains" }
        }
        const limit = Math.min(15, Math.max(1, Number(args.limit) || 10))
        const mapRow = (row: Record<string, unknown>) => ({
          id: row.id,
          invoice_number: row.invoice_number,
          status: row.status,
          total: row.total,
          due_date: row.due_date,
          customer: (row.customers as { name?: string } | null)?.name ?? null,
        })
        const seen = new Set<string>()
        const merged: Record<string, unknown>[] = []

        const pushRows = (rows: Record<string, unknown>[] | null) => {
          for (const row of rows ?? []) {
            const id = String(row.id ?? "")
            if (!id || seen.has(id)) continue
            seen.add(id)
            merged.push(row)
          }
        }

        if (numQ) {
          const esc = numQ.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
          const { data, error } = await supabase
            .from("invoices")
            .select("id, invoice_number, status, total, due_date, customer_id, created_at, customers(name)")
            .eq("business_id", businessId)
            .is("deleted_at", null)
            .ilike("invoice_number", `%${esc}%`)
            .order("created_at", { ascending: false })
            .limit(limit)
          if (error) return { ok: false, error: error.message }
          pushRows(data as Record<string, unknown>[])
        }

        if (custQ && merged.length < limit) {
          const esc = custQ.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
          const pattern = `%${esc}%`
          const [{ data: byName, error: eName }, { data: byEmail, error: eEmail }] = await Promise.all([
            supabase.from("customers").select("id").eq("business_id", businessId).ilike("name", pattern).limit(60),
            supabase.from("customers").select("id").eq("business_id", businessId).ilike("email", pattern).limit(60),
          ])
          if (eName || eEmail) {
            return { ok: false, error: eName?.message || eEmail?.message || "Customer search failed" }
          }
          const custIdSet = new Set<string>()
          for (const r of [...(byName ?? []), ...(byEmail ?? [])]) {
            custIdSet.add(String((r as { id: string }).id))
          }
          const custIds = [...custIdSet]
          if (custIds.length > 0) {
            const { data: invData, error: invErr } = await supabase
              .from("invoices")
              .select("id, invoice_number, status, total, due_date, customer_id, created_at, customers(name)")
              .eq("business_id", businessId)
              .is("deleted_at", null)
              .in("customer_id", custIds)
              .order("created_at", { ascending: false })
              .limit(limit * 2)
            if (invErr) return { ok: false, error: invErr.message }
            pushRows(invData as Record<string, unknown>[])
          }
        }

        merged.sort((a, b) => {
          const ta = new Date(String((a as { created_at?: string }).created_at || 0)).getTime()
          const tb = new Date(String((b as { created_at?: string }).created_at || 0)).getTime()
          return tb - ta
        })
        const trimmed = merged.slice(0, limit).map(mapRow)
        return {
          ok: true,
          result: JSON.stringify({
            tool: "search_invoices",
            query: numQ || null,
            customer_name_contains: custQ || null,
            results: trimmed,
          }),
        }
      }

      case "search_bills": {
        const q = String(args.query ?? "").trim().slice(0, 80)
        if (!q) return { ok: false, error: "query required" }
        const limit = Math.min(15, Math.max(1, Number(args.limit) || 10))
        const safe = q.replace(/[%]/g, "").slice(0, 60)
        const pattern = `%${safe}%`
        const { data: byNumber, error: errNum } = await supabase
          .from("bills")
          .select("id, bill_number, status, total, due_date, supplier_name, notes")
          .eq("business_id", businessId)
          .is("deleted_at", null)
          .ilike("bill_number", pattern)
          .order("created_at", { ascending: false })
          .limit(limit)
        if (errNum) return { ok: false, error: errNum.message }
        const seen = new Set((byNumber ?? []).map((r: { id: string }) => r.id))
        let merged: Record<string, unknown>[] = [...(byNumber ?? [])]
        if (merged.length < limit) {
          const { data: bySupplier, error: errSup } = await supabase
            .from("bills")
            .select("id, bill_number, status, total, due_date, supplier_name, notes")
            .eq("business_id", businessId)
            .is("deleted_at", null)
            .ilike("supplier_name", pattern)
            .order("created_at", { ascending: false })
            .limit(limit)
          if (!errSup && bySupplier) {
            for (const row of bySupplier) {
              if (!seen.has(row.id)) {
                seen.add(row.id)
                merged.push(row)
              }
            }
          }
        }
        if (merged.length < limit) {
          const { data: byNotes, error: errNotes } = await supabase
            .from("bills")
            .select("id, bill_number, status, total, due_date, supplier_name, notes")
            .eq("business_id", businessId)
            .is("deleted_at", null)
            .ilike("notes", pattern)
            .order("created_at", { ascending: false })
            .limit(limit)
          if (!errNotes && byNotes) {
            for (const row of byNotes) {
              if (!seen.has(row.id)) {
                seen.add(row.id)
                merged.push(row)
              }
            }
          }
        }
        const needle = safe.toLowerCase()
        merged = merged.filter((row) => {
          const bn = String(row.bill_number || "").toLowerCase()
          const sup = String(row.supplier_name || "").toLowerCase()
          const notes = String(row.notes || "").toLowerCase()
          return bn.includes(needle) || sup.includes(needle) || notes.includes(needle)
        })
        merged = merged.slice(0, limit)
        return {
          ok: true,
          result: JSON.stringify({
            tool: "search_bills",
            query: q,
            results: merged.map((row) => ({
              id: row.id,
              bill_number: row.bill_number,
              status: row.status,
              total: row.total,
              due_date: row.due_date,
              supplier_name: row.supplier_name ?? null,
            })),
          }),
        }
      }

      case "get_tax_profile": {
        const { data, error } = await supabase
          .from("businesses")
          .select("vat_scheme, cit_rate_code, tin, default_currency, trading_name, legal_name")
          .eq("id", businessId)
          .maybeSingle()
        if (error) return { ok: false, error: error.message }
        return {
          ok: true,
          result: JSON.stringify({
            tool: "get_tax_profile",
            vat_scheme: (data as { vat_scheme?: string } | null)?.vat_scheme ?? null,
            cit_rate_code: (data as { cit_rate_code?: string } | null)?.cit_rate_code ?? null,
            tin: (data as { tin?: string } | null)?.tin ?? null,
            default_currency: (data as { default_currency?: string } | null)?.default_currency ?? null,
            trading_name: (data as { trading_name?: string } | null)?.trading_name ?? null,
            legal_name: (data as { legal_name?: string } | null)?.legal_name ?? null,
          }),
        }
      }

      case "get_payroll_runs_summary": {
        const allHistory = Boolean(args.all_history)
        const includeStaffEntries = Boolean(args.include_staff_entries)
        const monthsBack = allHistory
          ? null
          : Math.min(120, Math.max(1, Number(args.months_back) || 12))
        const now = new Date()

        let runQuery = supabase
          .from("payroll_runs")
          .select(
            "id, payroll_month, status, total_gross_salary, total_net_salary, total_deductions, total_paye, total_ssnit_employee, total_ssnit_employer, approved_at, journal_entry_id"
          )
          .eq("business_id", businessId)
          .is("deleted_at", null)
          .order("payroll_month", { ascending: false })
          .limit(PAYROLL_RUNS_MAX)

        if (!allHistory && monthsBack != null) {
          const cutoff = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1)
          const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`
          runQuery = runQuery.gte("payroll_month", cutoffStr)
        }

        const { data, error } = await runQuery

        if (error) {
          return { ok: false, error: error.message }
        }

        type RunRow = {
          id: string
          payroll_month: string
          status?: string | null
          total_gross_salary?: number | null
          total_net_salary?: number | null
          total_deductions?: number | null
          total_paye?: number | null
          total_ssnit_employee?: number | null
          total_ssnit_employer?: number | null
          approved_at?: string | null
          journal_entry_id?: string | null
        }

        type StaffEmbed = { id?: string; name?: string | null; position?: string | null } | null
        type EntryRowDb = {
          id: string
          payroll_run_id: string
          staff_id: string
          basic_salary?: number | null
          allowances_total?: number | null
          deductions_total?: number | null
          gross_salary?: number | null
          net_salary?: number | null
          paye?: number | null
          taxable_income?: number | null
          ssnit_employee?: number | null
          ssnit_employer?: number | null
          regular_allowances_amount?: number | null
          bonus_amount?: number | null
          overtime_amount?: number | null
          staff?: StaffEmbed
        }

        type PayrollStaffEntryOut = {
          id: string
          staff_id: string
          staff_name: string | null
          staff_position: string | null
          basic_salary?: number | null
          allowances_total?: number | null
          deductions_total?: number | null
          gross_salary?: number | null
          net_salary?: number | null
          paye?: number | null
          taxable_income?: number | null
          ssnit_employee?: number | null
          ssnit_employer?: number | null
          regular_allowances_amount?: number | null
          bonus_amount?: number | null
          overtime_amount?: number | null
        }

        const serializePayrollEntry = (e: EntryRowDb): PayrollStaffEntryOut => {
          const st = e.staff
          return {
            id: e.id,
            staff_id: e.staff_id,
            staff_name: st?.name ?? null,
            staff_position: st?.position ?? null,
            basic_salary: e.basic_salary,
            allowances_total: e.allowances_total,
            deductions_total: e.deductions_total,
            gross_salary: e.gross_salary,
            net_salary: e.net_salary,
            paye: e.paye,
            taxable_income: e.taxable_income,
            ssnit_employee: e.ssnit_employee,
            ssnit_employer: e.ssnit_employer,
            regular_allowances_amount: e.regular_allowances_amount,
            bonus_amount: e.bonus_amount,
            overtime_amount: e.overtime_amount,
          }
        }

        const runs = (data ?? []) as RunRow[]
        const runsTruncated = runs.length >= PAYROLL_RUNS_MAX

        const entriesByRunId = new Map<string, PayrollStaffEntryOut[]>()

        let entriesTruncated = false
        if (includeStaffEntries && runs.length > 0) {
          const runIds = runs.map((r) => r.id)
          const collected: EntryRowDb[] = []
          for (let i = 0; i < runIds.length; i += PAYROLL_RUN_ID_IN_CHUNK) {
            const chunk = runIds.slice(i, i + PAYROLL_RUN_ID_IN_CHUNK)
            const { data: entData, error: entErr } = await supabase
              .from("payroll_entries")
              .select(
                `id, payroll_run_id, staff_id, basic_salary, allowances_total, deductions_total, gross_salary, net_salary, paye, taxable_income, ssnit_employee, ssnit_employer, regular_allowances_amount, bonus_amount, overtime_amount, staff(id, name, position)`
              )
              .in("payroll_run_id", chunk)
            if (entErr) {
              return { ok: false, error: entErr.message }
            }
            for (const row of entData ?? []) {
              collected.push(row as EntryRowDb)
              if (collected.length >= PAYROLL_ENTRIES_MAX) {
                entriesTruncated = true
                break
              }
            }
            if (entriesTruncated) break
          }
          for (const e of collected) {
            const list = entriesByRunId.get(e.payroll_run_id) ?? []
            list.push(serializePayrollEntry(e))
            entriesByRunId.set(e.payroll_run_id, list)
          }
          for (const [, list] of entriesByRunId) {
            list.sort((a, b) =>
              String(a.staff_name || "").localeCompare(String(b.staff_name || ""), undefined, {
                sensitivity: "base",
              })
            )
          }
        }

        const finalized = (r: RunRow) => {
          const s = String(r.status || "").toLowerCase()
          return s === "approved" || s === "locked"
        }

        const fin = runs.filter(finalized)
        const sum = (arr: RunRow[], key: keyof RunRow) =>
          round2(arr.reduce((acc, r) => acc + (Number(r[key]) || 0), 0))

        const calendarYear = String(now.getFullYear())
        const yearStart = `${calendarYear}-01-01`
        const finYtd = fin.filter((r) => String(r.payroll_month) >= yearStart)

        let latestFinalized: RunRow | null = null
        for (const r of fin) {
          if (!latestFinalized || String(r.payroll_month) > String(latestFinalized.payroll_month)) {
            latestFinalized = r
          }
        }

        const scope = allHistory ? "all_payroll_runs_capped" : `rolling_${monthsBack}_months`

        return {
          ok: true,
          result: JSON.stringify({
            tool: "get_payroll_runs_summary",
            scope,
            all_history: allHistory,
            months_back: allHistory ? null : monthsBack,
            include_staff_entries: includeStaffEntries,
            payroll_run_count: runs.length,
            payroll_runs_truncated: runsTruncated,
            payroll_entries_truncated: includeStaffEntries ? entriesTruncated : null,
            payroll_entries_row_cap: includeStaffEntries ? PAYROLL_ENTRIES_MAX : null,
            runs: runs.map((r) => {
              const base = {
                id: r.id,
                payroll_month: r.payroll_month,
                status: r.status,
                total_gross_salary: r.total_gross_salary,
                total_net_salary: r.total_net_salary,
                total_deductions: r.total_deductions,
                total_paye: r.total_paye,
                total_ssnit_employee: r.total_ssnit_employee,
                total_ssnit_employer: r.total_ssnit_employer,
                approved_at: r.approved_at,
                journal_entry_id: r.journal_entry_id,
              }
              if (!includeStaffEntries) return base
              return {
                ...base,
                staff_entries: entriesByRunId.get(r.id) ?? [],
              }
            }),
            aggregates: {
              finalized_run_count: fin.length,
              draft_run_count: runs.filter((r) => String(r.status || "").toLowerCase() === "draft").length,
              total_net_salary_finalized_in_scope: sum(fin, "total_net_salary"),
              total_gross_salary_finalized_in_scope: sum(fin, "total_gross_salary"),
              total_paye_finalized_in_scope: sum(fin, "total_paye"),
              total_net_salary_finalized_calendar_ytd: sum(finYtd, "total_net_salary"),
              latest_finalized_month: latestFinalized?.payroll_month ?? null,
              latest_finalized_net_salary: latestFinalized?.total_net_salary ?? null,
            },
            definitions: {
              total_net_salary:
                "Total take-home pay for all staff in that payroll month (Finza payroll module).",
              draft:
                "Run not finalized; figures can change. Do not treat as amount paid or final.",
              approved_locked:
                "Finalized payroll for that month. Use total_net_salary for 'how much salary was processed' for that period. Bank transfer timing is outside this summary.",
              scope:
                "Aggregates and runs reflect the returned scope only; if *_truncated flags are true, totals may be incomplete vs the full database.",
            },
            navigation_hint: "/service/payroll",
          }),
        }
      }

      case "get_profit_and_loss_summary": {
        const gate = await gateAccountingReportRead(supabase, userId, businessId)
        if (!gate.ok) {
          return { ok: true, result: JSON.stringify({ tool: "get_profit_and_loss_summary", ok: false, error: gate.error }) }
        }
        const period_start = String(args.period_start ?? "").trim() || undefined
        const as_of_date = String(args.as_of_date ?? "").trim() || undefined
        const start_date = String(args.start_date ?? "").trim() || undefined
        const end_date = String(args.end_date ?? "").trim() || undefined
        const { data, error } = await getProfitAndLossReport(supabase, {
          businessId,
          period_start: period_start || null,
          as_of_date: as_of_date || null,
          start_date: start_date || null,
          end_date: end_date || null,
        })
        if (error || !data) {
          return {
            ok: true,
            result: JSON.stringify({
              tool: "get_profit_and_loss_summary",
              ok: false,
              error: error || "No P&L data",
            }),
          }
        }
        return { ok: true, result: JSON.stringify(summarizePnLForAssist(data)) }
      }

      case "get_balance_sheet_summary": {
        const gate = await gateAccountingReportRead(supabase, userId, businessId)
        if (!gate.ok) {
          return {
            ok: true,
            result: JSON.stringify({ tool: "get_balance_sheet_summary", ok: false, error: gate.error }),
          }
        }
        const period_start = String(args.period_start ?? "").trim() || undefined
        const as_of_date = String(args.as_of_date ?? "").trim() || undefined
        const { data, error } = await getBalanceSheetReport(supabase, {
          businessId,
          period_start: period_start || null,
          as_of_date: as_of_date || null,
        })
        if (error || !data) {
          return {
            ok: true,
            result: JSON.stringify({
              tool: "get_balance_sheet_summary",
              ok: false,
              error: error || "No balance sheet data",
            }),
          }
        }
        return { ok: true, result: JSON.stringify(summarizeBSForAssist(data)) }
      }

      case "get_invoice_detail": {
        const invoiceId = String(args.invoice_id ?? "").trim()
        if (!invoiceId) return { ok: false, error: "invoice_id required" }
        const { data: inv, error } = await supabase
          .from("invoices")
          .select(
            `
            id,
            invoice_number,
            status,
            total,
            subtotal,
            issue_date,
            due_date,
            notes,
            customer_id,
            created_at,
            customers ( name, email, phone ),
            invoice_items (
              description,
              qty,
              unit_price,
              discount_amount,
              line_subtotal
            )
          `
          )
          .eq("business_id", businessId)
          .eq("id", invoiceId)
          .is("deleted_at", null)
          .maybeSingle()
        if (error) return { ok: false, error: error.message }
        if (!inv) {
          return {
            ok: true,
            result: JSON.stringify({
              tool: "get_invoice_detail",
              ok: false,
              error: "Invoice not found in this workspace",
            }),
          }
        }
        const row = inv as Record<string, unknown>
        const items = (row.invoice_items as Record<string, unknown>[] | null) ?? []
        const lineSummaries = items.slice(0, 40).map((it) => ({
          description: it.description ?? null,
          qty: it.qty ?? null,
          unit_price: it.unit_price ?? null,
          discount_amount: it.discount_amount ?? null,
          line_subtotal: it.line_subtotal ?? null,
        }))
        return {
          ok: true,
          result: JSON.stringify({
            tool: "get_invoice_detail",
            ok: true,
            id: row.id,
            invoice_number: row.invoice_number,
            status: row.status,
            total: row.total,
            subtotal: row.subtotal ?? null,
            issue_date: row.issue_date ?? null,
            due_date: row.due_date ?? null,
            notes_preview:
              typeof row.notes === "string" && row.notes ? String(row.notes).slice(0, 400) : null,
            customer: row.customers
              ? {
                  name: (row.customers as { name?: string }).name ?? null,
                  email: (row.customers as { email?: string }).email ?? null,
                  phone: (row.customers as { phone?: string }).phone ?? null,
                }
              : null,
            line_items: lineSummaries,
            line_items_truncated: items.length > 40,
            navigation_hint: `/service/invoices/${invoiceId}/view`,
          }),
        }
      }

      case "list_open_invoices": {
        const limit = Math.min(25, Math.max(1, Number(args.limit) || 15))
        const overdueOnly = Boolean(args.overdue_only)
        const today = localTodayYmd()
        const openStatuses = ["sent", "overdue", "partially_paid", "partial", "unpaid"]
        let q = supabase
          .from("invoices")
          .select("id, invoice_number, status, total, due_date, customer_id, created_at, customers(name)")
          .eq("business_id", businessId)
          .is("deleted_at", null)
          .in("status", openStatuses)
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(limit)
        if (overdueOnly) {
          q = q.not("due_date", "is", null).lt("due_date", today)
        }
        const { data, error } = await q
        if (error) return { ok: false, error: error.message }
        return {
          ok: true,
          result: JSON.stringify({
            tool: "list_open_invoices",
            overdue_only: overdueOnly,
            count: (data ?? []).length,
            results: (data ?? []).map((row: Record<string, unknown>) => ({
              id: row.id,
              invoice_number: row.invoice_number,
              status: row.status,
              total: row.total,
              open_amount: row.total ?? null,
              due_date: row.due_date,
              customer: (row.customers as { name?: string } | null)?.name ?? null,
            })),
            navigation_hint: "/service/invoices",
          }),
        }
      }

      case "search_customers": {
        const q = String(args.query ?? "").trim().slice(0, 80)
        if (!q) return { ok: false, error: "query required" }
        const limit = Math.min(20, Math.max(1, Number(args.limit) || 12))
        const esc = q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
        const pattern = `%${esc}%`
        const [{ data: byName, error: eName }, { data: byEmail, error: eEmail }] = await Promise.all([
          supabase
            .from("customers")
            .select("id, name, email, phone")
            .eq("business_id", businessId)
            .ilike("name", pattern)
            .limit(limit),
          supabase
            .from("customers")
            .select("id, name, email, phone")
            .eq("business_id", businessId)
            .ilike("email", pattern)
            .limit(limit),
        ])
        if (eName || eEmail) {
          return { ok: false, error: eName?.message || eEmail?.message || "Customer search failed" }
        }
        const seen = new Set<string>()
        const rows: Record<string, unknown>[] = []
        for (const r of [...(byName ?? []), ...(byEmail ?? [])]) {
          const id = String((r as { id: string }).id)
          if (seen.has(id)) continue
          seen.add(id)
          rows.push(r as Record<string, unknown>)
          if (rows.length >= limit) break
        }
        return {
          ok: true,
          result: JSON.stringify({
            tool: "search_customers",
            query: q,
            results: rows.map((c) => ({
              id: c.id,
              name: c.name ?? null,
              email: c.email ?? null,
              phone: c.phone ?? null,
            })),
            navigation_hint: "/service/customers",
          }),
        }
      }

      case "get_expense_totals_by_category": {
        const ymRaw = String(args.year_month ?? "").trim()
        const now = new Date()
        let y = now.getFullYear()
        let m = now.getMonth() + 1
        if (/^\d{4}-\d{2}$/.test(ymRaw)) {
          const [ys, ms] = ymRaw.split("-")
          y = Number(ys)
          m = Number(ms)
          if (m < 1 || m > 12) return { ok: false, error: "Invalid year_month" }
        } else if (ymRaw) {
          return { ok: false, error: "year_month must be YYYY-MM" }
        }
        const start = `${y}-${String(m).padStart(2, "0")}-01`
        const lastDay = new Date(y, m, 0).getDate()
        const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
        const { data, error } = await supabase
          .from("expenses")
          .select("total, category_id, expense_categories ( id, name )")
          .eq("business_id", businessId)
          .is("deleted_at", null)
          .gte("date", start)
          .lte("date", end)
        if (error) return { ok: false, error: error.message }
        const byCat = new Map<string, { name: string; total: number }>()
        for (const row of data ?? []) {
          const r = row as {
            total?: number | null
            category_id?: string | null
            expense_categories?: { id?: string; name?: string } | null
          }
          const cid = r.category_id ? String(r.category_id) : "uncategorized"
          const name = r.expense_categories?.name?.trim() || (cid === "uncategorized" ? "Uncategorized" : "Category")
          const prev = byCat.get(cid) ?? { name, total: 0 }
          prev.total = round2(prev.total + (Number(r.total) || 0))
          prev.name = name
          byCat.set(cid, prev)
        }
        const sorted = [...byCat.entries()]
          .map(([category_id, v]) => ({
            category_id: category_id === "uncategorized" ? null : category_id,
            category_name: v.name,
            total: v.total,
          }))
          .sort((a, b) => b.total - a.total)
        return {
          ok: true,
          result: JSON.stringify({
            tool: "get_expense_totals_by_category",
            year_month: `${y}-${String(m).padStart(2, "0")}`,
            period_start: start,
            period_end: end,
            categories: sorted,
            grand_total: round2(sorted.reduce((s, x) => s + x.total, 0)),
            navigation_hint: "/service/expenses",
          }),
        }
      }

      case "extract_receipt_ocr": {
        const receiptPath = String(args.receipt_path ?? "").trim()
        if (!receiptPath) return { ok: false, error: "receipt_path required" }
        const docRaw = String(args.document_type ?? "expense").toLowerCase()
        const documentType: DocumentType = docRaw === "supplier_bill" ? "supplier_bill" : "expense"
        const run = await runPersistedReceiptOcr({
          supabase,
          userId,
          businessId,
          receiptPath,
          documentType,
          sourceType: "manual_upload",
        })
        const ocr = run.ocr
        if (!ocr.ok) {
          return {
            ok: true,
            result: JSON.stringify({
              tool: "extract_receipt_ocr",
              ok: false,
              error: ocr.error,
              code: ocr.code,
              suggestions: ocr.suggestions ?? null,
              confidence: ocr.confidence ?? null,
              document_id: run.documentId || null,
              note: "OCR is suggestion-only; user should confirm before booking.",
            }),
          }
        }
        return {
          ok: true,
          result: JSON.stringify({
            tool: "extract_receipt_ocr",
            ok: true,
            suggestions: ocr.suggestions,
            confidence: ocr.confidence,
            document_id: run.documentId || null,
            note: "Figures are read from the receipt image heuristically — not posted to the ledger. To record: Go to: /service/expenses/create or /bills/create",
          }),
        }
      }

      default:
        return { ok: false, error: "Unhandled tool" }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Tool execution failed"
    return { ok: false, error: msg }
  }
}

/** Simple in-memory rate limit: max calls per window per user id. */
const rateBucket = new Map<string, { count: number; resetAt: number }>()
const RATE_MAX = 40
const RATE_WINDOW_MS = 60_000

export function checkAiRateLimit(userId: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now()
  const row = rateBucket.get(userId)
  if (!row || now > row.resetAt) {
    rateBucket.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return { ok: true }
  }
  if (row.count >= RATE_MAX) {
    return { ok: false, retryAfterSec: Math.ceil((row.resetAt - now) / 1000) }
  }
  row.count += 1
  return { ok: true }
}
