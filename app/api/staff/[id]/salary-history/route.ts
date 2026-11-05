import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { hasPermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import {
  deriveEmployeeSalaryPaymentSummary,
  roundPayrollMoney,
  summarizeEmployeeSalaryHistory,
  type EmployeeSalaryPaymentStatus,
} from "@/lib/payroll/staffSalaryHistory"

type EmbeddedRun = {
  id: string
  payroll_month: string
  pay_period_start?: string | null
  pay_period_end?: string | null
  payroll_frequency?: string | null
  run_type?: string | null
  status: string
  business_id: string
  reversed_at?: string | null
}

type EntryRow = {
  id: string
  payroll_run_id: string
  staff_id: string
  basic_salary?: number | null
  gross_salary?: number | null
  allowances_total?: number | null
  deductions_total?: number | null
  ssnit_employee?: number | null
  ssnit_employer?: number | null
  paye?: number | null
  net_salary?: number | null
  is_included?: boolean | null
  payroll_runs: EmbeddedRun | EmbeddedRun[] | null
}

type BatchItemRow = {
  id: string
  payroll_run_id: string
  payroll_entry_id: string
  amount?: number | null
  status?: string | null
  payroll_payment_id?: string | null
  payment_reference?: string | null
  paid_at?: string | null
}

type PaymentRow = {
  id: string
  batch_item_id?: string | null
  payroll_run_id: string
  amount?: number | null
  payment_date?: string | null
  reference?: string | null
  payment_account_id?: string | null
}

type PaymentAccountInfo = {
  id: string
  name: string
  code: string
}

function embeddedRun(value: EntryRow["payroll_runs"]): EmbeddedRun | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function parsePositiveInt(raw: string | null, fallback: number, max: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.min(Math.floor(n), max)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: staffId } = await Promise.resolve(params)
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const tierDenied = await enforceServiceIndustryMinTier(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (tierDenied) return tierDenied

    const canViewPayroll = await hasPermission(
      supabase,
      user.id,
      business.id,
      PERMISSIONS.PAYROLL_VIEW
    )
    const canExportPayroll = await hasPermission(
      supabase,
      user.id,
      business.id,
      PERMISSIONS.PAYROLL_EXPORT
    )
    if (!canViewPayroll && !canExportPayroll) {
      return NextResponse.json(
        { error: "Payroll view permission required", code: "PAYROLL_VIEW_REQUIRED" },
        { status: 403 }
      )
    }

    const { data: staff, error: staffError } = await supabase
      .from("staff")
      .select("id, name, basic_salary, salary_basis, employment_type, start_date, status")
      .eq("id", staffId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .maybeSingle()

    if (staffError) {
      console.error("[staff salary history] staff lookup", staffError)
      return NextResponse.json({ error: staffError.message }, { status: 500 })
    }
    if (!staff) return NextResponse.json({ error: "Staff not found" }, { status: 404 })

    const { searchParams } = new URL(request.url)
    const yearRaw = searchParams.get("year")
    if (yearRaw && !/^\d{4}$/.test(yearRaw)) {
      return NextResponse.json({ error: "year must be a four-digit year" }, { status: 400 })
    }
    const year = yearRaw ? Number(yearRaw) : null
    const limit = Math.max(1, parsePositiveInt(searchParams.get("limit"), 24, 100))
    const offset = parsePositiveInt(searchParams.get("offset"), 0, 10000)

    let historyQuery = supabase
      .from("payroll_entries")
      .select(
        `
        id,
        payroll_run_id,
        staff_id,
        basic_salary,
        gross_salary,
        allowances_total,
        deductions_total,
        ssnit_employee,
        ssnit_employer,
        paye,
        net_salary,
        is_included,
        payroll_runs!inner (
          id,
          payroll_month,
          pay_period_start,
          pay_period_end,
          payroll_frequency,
          run_type,
          status,
          business_id,
          reversed_at
        )
      `
      )
      .eq("staff_id", staffId)
      .eq("is_included", true)
      .eq("payroll_runs.business_id", business.id)
      .in("payroll_runs.status", ["approved", "locked", "reversed"])
      .order("payroll_month", { referencedTable: "payroll_runs", ascending: false })
      .limit(1000)

    if (year) {
      historyQuery = historyQuery
        .gte("payroll_runs.payroll_month", `${year}-01-01`)
        .lte("payroll_runs.payroll_month", `${year}-12-31`)
    }

    const { data: entryRows, error: entriesError } = await historyQuery
    if (entriesError) {
      console.error("[staff salary history] entries", entriesError)
      return NextResponse.json({ error: entriesError.message }, { status: 500 })
    }

    const normalizedEntries = ((entryRows || []) as unknown as EntryRow[])
      .map((row) => ({ row, run: embeddedRun(row.payroll_runs) }))
      .filter((x): x is { row: EntryRow; run: EmbeddedRun } => Boolean(x.run))

    const hasMore = normalizedEntries.length > offset + limit
    const runIds = Array.from(new Set(normalizedEntries.map((x) => x.run.id)))

    let payslips: Array<{
      id: string
      payroll_run_id: string
      payroll_entry_id: string | null
      public_token: string | null
      created_at?: string | null
    }> = []
    let batchItems: BatchItemRow[] = []
    let payments: PaymentRow[] = []
    let aggregatePayments: PaymentRow[] = []

    if (runIds.length > 0) {
      const [payslipRes, itemRes, aggregateRes] = await Promise.all([
        supabase
          .from("payslips")
          .select("id, payroll_run_id, payroll_entry_id, public_token, created_at")
          .eq("staff_id", staffId)
          .in("payroll_run_id", runIds),
        supabase
          .from("payroll_payment_batch_items")
          .select(
            "id, payroll_run_id, payroll_entry_id, amount, status, payroll_payment_id, payment_reference, paid_at"
          )
          .eq("business_id", business.id)
          .eq("staff_id", staffId)
          .in("payroll_run_id", runIds)
          .is("deleted_at", null),
        supabase
          .from("payroll_payments")
          .select("id, batch_item_id, payroll_run_id, amount, payment_date, reference")
          .eq("business_id", business.id)
          .in("payroll_run_id", runIds)
          .is("batch_item_id", null)
          .is("batch_id", null)
          .is("deleted_at", null)
          .is("reversed_at", null)
          .not("journal_entry_id", "is", null),
      ])

      if (payslipRes.error || itemRes.error || aggregateRes.error) {
        const message =
          payslipRes.error?.message || itemRes.error?.message || aggregateRes.error?.message
        console.error("[staff salary history] related data", message)
        return NextResponse.json({ error: message || "Failed to load salary history" }, { status: 500 })
      }

      payslips = payslipRes.data || []
      batchItems = (itemRes.data || []) as BatchItemRow[]
      aggregatePayments = (aggregateRes.data || []) as PaymentRow[]

      const itemIds = batchItems.map((item) => item.id)
      if (itemIds.length > 0) {
        const { data: paymentRows, error: paymentError } = await supabase
          .from("payroll_payments")
          .select("id, batch_item_id, payroll_run_id, amount, payment_date, reference, payment_account_id")
          .eq("business_id", business.id)
          .in("batch_item_id", itemIds)
          .is("deleted_at", null)
          .is("reversed_at", null)
          .not("journal_entry_id", "is", null)
        if (paymentError) {
          console.error("[staff salary history] payments", paymentError)
          return NextResponse.json({ error: paymentError.message }, { status: 500 })
        }
        payments = (paymentRows || []) as PaymentRow[]
      }
    }

    let paymentAccountsById = new Map<string, PaymentAccountInfo>()
    const paymentAccountIds = Array.from(
      new Set(
        payments
          .map((payment) => payment.payment_account_id)
          .filter((id): id is string => Boolean(id))
      )
    )
    if (paymentAccountIds.length > 0) {
      const { data: accountRows, error: accountError } = await supabase
        .from("accounts")
        .select("id, name, code")
        .eq("business_id", business.id)
        .in("id", paymentAccountIds)

      if (accountError) {
        console.error("[staff salary history] payment accounts", accountError)
      } else {
        paymentAccountsById = new Map(
          (accountRows || []).map((account) => [
            String(account.id),
            { id: String(account.id), name: String(account.name), code: String(account.code) },
          ])
        )
      }
    }

    const payslipByEntry = new Map<string, (typeof payslips)[number]>()
    for (const payslip of payslips) {
      if (payslip.payroll_entry_id) payslipByEntry.set(payslip.payroll_entry_id, payslip)
    }

    const itemsByEntry = new Map<string, BatchItemRow[]>()
    for (const item of batchItems) {
      const list = itemsByEntry.get(item.payroll_entry_id) || []
      list.push(item)
      itemsByEntry.set(item.payroll_entry_id, list)
    }

    const paymentByItem = new Map<string, PaymentRow>()
    for (const payment of payments) {
      if (payment.batch_item_id) paymentByItem.set(payment.batch_item_id, payment)
    }

    const aggregatesByRun = new Map<string, PaymentRow[]>()
    for (const payment of aggregatePayments) {
      const list = aggregatesByRun.get(payment.payroll_run_id) || []
      list.push(payment)
      aggregatesByRun.set(payment.payroll_run_id, list)
    }

    const history = normalizedEntries.map(({ row, run }) => {
      const items = itemsByEntry.get(row.id) || []
      const confirmedPayments = items
        .map((item) => paymentByItem.get(item.id))
        .filter((p): p is PaymentRow => Boolean(p))
      const confirmedPaid = confirmedPayments.reduce(
        (sum, payment) => sum + roundPayrollMoney(payment.amount),
        0
      )
      const aggregate = aggregatesByRun.get(run.id) || []
      const paymentSummary = deriveEmployeeSalaryPaymentSummary({
        netSalary: row.net_salary ?? null,
        confirmedPaid,
        hasUnallocatedAggregatePayment: aggregate.length > 0,
      })
      const payslip = payslipByEntry.get(row.id)
      const isReversedRun = run.status === "reversed"

      return {
        payroll_run_id: run.id,
        payroll_entry_id: row.id,
        payroll_month: run.payroll_month,
        pay_period_start: run.pay_period_start ?? null,
        pay_period_end: run.pay_period_end ?? null,
        payroll_frequency: run.payroll_frequency ?? "monthly",
        run_type: run.run_type ?? "regular",
        run_status: run.status,
        is_reversed_run: isReversedRun,
        basic_salary: roundPayrollMoney(row.basic_salary),
        allowances_total: roundPayrollMoney(row.allowances_total),
        deductions_total: roundPayrollMoney(row.deductions_total),
        gross_salary: roundPayrollMoney(row.gross_salary),
        paye: roundPayrollMoney(row.paye),
        ssnit_employee: roundPayrollMoney(row.ssnit_employee),
        ssnit_employer: roundPayrollMoney(row.ssnit_employer),
        net_salary: roundPayrollMoney(row.net_salary),
        payment_status: paymentSummary.payment_status as EmployeeSalaryPaymentStatus,
        payment_status_label: paymentSummary.payment_status_label,
        confirmed_paid_amount: paymentSummary.confirmed_paid_amount,
        outstanding_amount: paymentSummary.outstanding_amount,
        unverified_amount: paymentSummary.unverified_amount,
        has_unallocated_aggregate_payment: paymentSummary.has_unallocated_aggregate_payment,
        payments: confirmedPayments.map((payment) => {
          const account = payment.payment_account_id
            ? paymentAccountsById.get(payment.payment_account_id)
            : undefined
          return {
            id: payment.id,
            amount: roundPayrollMoney(payment.amount),
            payment_date: payment.payment_date ?? null,
            reference: payment.reference ?? null,
            payment_method: account?.name ?? null,
            payment_account_code: account?.code ?? null,
          }
        }),
        aggregate_payments: aggregate.map((payment) => ({
          id: payment.id,
          amount: roundPayrollMoney(payment.amount),
          payment_date: payment.payment_date ?? null,
          reference: payment.reference ?? null,
        })),
        payslip: payslip
          ? {
              id: payslip.id,
              public_token: payslip.public_token,
              created_at: payslip.created_at ?? null,
            }
          : null,
      }
    })

    const summary = summarizeEmployeeSalaryHistory(
      history.map((row) => ({
        net_salary: row.net_salary,
        confirmed_paid_amount: row.confirmed_paid_amount,
        payment_status: row.payment_status,
        outstanding_amount: row.outstanding_amount,
        unverified_amount: row.unverified_amount,
        is_reversed_run: row.is_reversed_run,
      }))
    )

    const { data: yearRows, error: yearsError } = await supabase
      .from("payroll_entries")
      .select("id, payroll_runs!inner(payroll_month, business_id, status)")
      .eq("staff_id", staffId)
      .eq("is_included", true)
      .eq("payroll_runs.business_id", business.id)
      .in("payroll_runs.status", ["approved", "locked", "reversed"])

    if (yearsError) {
      console.error("[staff salary history] years", yearsError)
    }

    const availableYears = Array.from(
      new Set(
        ((yearRows || []) as unknown as EntryRow[])
          .map((row) => embeddedRun(row.payroll_runs)?.payroll_month)
          .filter((month): month is string => Boolean(month))
          .map((month) => Number(String(month).slice(0, 4)))
          .filter((y) => Number.isFinite(y))
      )
    ).sort((a, b) => b - a)

    return NextResponse.json({
      staff: {
        id: staff.id,
        name: staff.name,
        basic_salary: roundPayrollMoney(staff.basic_salary),
        salary_basis: staff.salary_basis || "monthly",
        employment_type: staff.employment_type,
        start_date: staff.start_date,
        status: staff.status,
      },
      summary: {
        ...summary,
        unallocated_aggregate_payment_total: roundPayrollMoney(
          history
            .filter((row) => !row.is_reversed_run)
            .reduce(
              (sum, row) =>
                sum + row.aggregate_payments.reduce((s, payment) => s + payment.amount, 0),
              0
            )
        ),
      },
      history: history.slice(offset, offset + limit),
      available_years: availableYears,
      pagination: {
        limit,
        offset,
        has_more: hasMore,
      },
    })
  } catch (error: unknown) {
    console.error("[staff salary history]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
