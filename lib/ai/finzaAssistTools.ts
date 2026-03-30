import type { SupabaseClient } from "@supabase/supabase-js"
import { performReceiptOcr } from "@/lib/receipt/performReceiptOcr"
import type { DocumentType } from "@/lib/receipt/receiptOcr"

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
        "Read-only: search invoices by invoice number substring. Returns up to 15 matches with id, number, status, total, due_date.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Part of the invoice number to match" },
          limit: { type: "integer", description: "Max results 1–15", minimum: 1, maximum: 15 },
        },
        required: ["query"],
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
        const q = String(args.query ?? "").trim().slice(0, 80)
        if (!q) return { ok: false, error: "query required" }
        const limit = Math.min(15, Math.max(1, Number(args.limit) || 10))
        const { data, error } = await supabase
          .from("invoices")
          .select("id, invoice_number, status, total, due_date, customer_id, customers(name)")
          .eq("business_id", businessId)
          .is("deleted_at", null)
          .ilike("invoice_number", `%${q.replace(/%/g, "\\%")}%`)
          .order("created_at", { ascending: false })
          .limit(limit)
        if (error) return { ok: false, error: error.message }
        return {
          ok: true,
          result: JSON.stringify({
            tool: "search_invoices",
            query: q,
            results: (data ?? []).map((row: Record<string, unknown>) => ({
              id: row.id,
              invoice_number: row.invoice_number,
              status: row.status,
              total: row.total,
              due_date: row.due_date,
              customer: (row.customers as { name?: string } | null)?.name ?? null,
            })),
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

      case "extract_receipt_ocr": {
        const receiptPath = String(args.receipt_path ?? "").trim()
        if (!receiptPath) return { ok: false, error: "receipt_path required" }
        const docRaw = String(args.document_type ?? "expense").toLowerCase()
        const documentType: DocumentType = docRaw === "supplier_bill" ? "supplier_bill" : "expense"
        const ocr = await performReceiptOcr(supabase, {
          userId,
          businessId,
          receiptPath,
          documentType,
        })
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
            note: "Figures are read from the receipt image heuristically — not posted to the ledger. To record: Go to: /service/expenses/create or /service/bills",
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
