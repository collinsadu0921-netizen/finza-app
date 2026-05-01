/**
 * Client-side business snapshot for Finza Assist only.
 * Narrow columns + row caps (not a full GL/accounting export).
 */
import type { SupabaseClient } from "@supabase/supabase-js"

const INV_LIMIT = 50
const BILL_LIMIT = 50
const CUSTOMER_LIMIT = 100
const SUPPLIER_LIMIT = 100
const SERVICE_JOB_LIMIT = 50
const JEL_LIMIT = 200
const SERVICE_JOB_USAGE_LIMIT = 400
/** Journal entry headers sampled for assistant (transaction list + embedded lines). */
const JE_HEADER_LIMIT = 50

function roundMoney(value: number) {
  return Math.round((value || 0) * 100) / 100
}

function monthRange(monthOffset: number) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0)
  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  }
}

/**
 * Loads a capped, column-pruned snapshot for the assistant prompt.
 * Account balances inferred from journal_entry_lines are approximate (recent rows only).
 */
export async function fetchAssistantBusinessSnapshot(
  supabase: SupabaseClient,
  aiBusinessId: string
): Promise<Record<string, unknown>> {
  const currentMonth = monthRange(0)
  const lastMonth = monthRange(-1)

  const [
    transactionsResult,
    invoicesResult,
    billsResult,
    customersResult,
    suppliersResult,
    accountsResult,
    accountLinesResult,
    businessProfileResult,
    serviceJobsResult,
    serviceJobUsageResult,
    currentMonthPaymentsResult,
    currentMonthExpensesResult,
    lastMonthPaymentsResult,
    lastMonthExpensesResult,
  ] = await Promise.all([
    supabase
      .from("journal_entries")
      .select(
        "id, date, description, reference_type, created_at, journal_entry_lines(account_id, debit, credit)"
      )
      .eq("business_id", aiBusinessId)
      .order("created_at", { ascending: false })
      .limit(JE_HEADER_LIMIT),
    supabase
      .from("invoices")
      .select(
        "id, customer_id, total, status, due_date, created_at, balance_due, amount_due"
      )
      .eq("business_id", aiBusinessId)
      .order("created_at", { ascending: false })
      .limit(INV_LIMIT),
    supabase
      .from("bills")
      .select(
        "id, supplier_id, total, amount, status, due_date, created_at, balance_due, amount_due, wht_applicable, wht_amount"
      )
      .eq("business_id", aiBusinessId)
      .order("created_at", { ascending: false })
      .limit(BILL_LIMIT),
    supabase
      .from("customers")
      .select("id, name, email, created_at")
      .eq("business_id", aiBusinessId)
      .order("created_at", { ascending: false })
      .limit(CUSTOMER_LIMIT),
    supabase
      .from("suppliers")
      .select("id, name, created_at")
      .eq("business_id", aiBusinessId)
      .order("created_at", { ascending: false })
      .limit(SUPPLIER_LIMIT),
    supabase
      .from("accounts")
      .select("id, code, name, type, sub_type")
      .eq("business_id", aiBusinessId)
      .order("code", { ascending: true }),
    supabase
      .from("journal_entry_lines")
      .select(
        "account_id, debit, credit, journal_entries!inner(business_id, created_at)"
      )
      .eq("journal_entries.business_id", aiBusinessId)
      .order("created_at", { ascending: false, referencedTable: "journal_entries" })
      .limit(JEL_LIMIT),
    supabase.from("businesses").select("*").eq("id", aiBusinessId).maybeSingle(),
    supabase
      .from("service_jobs")
      .select(
        "id, status, amount, total_amount, quoted_amount, total, assigned_staff_id, staff_id, technician_id, assigned_to, created_at"
      )
      .eq("business_id", aiBusinessId)
      .order("created_at", { ascending: false })
      .limit(SERVICE_JOB_LIMIT),
    supabase
      .from("service_job_material_usage")
      .select("job_id, total_cost, created_at")
      .eq("business_id", aiBusinessId)
      .order("created_at", { ascending: false })
      .limit(SERVICE_JOB_USAGE_LIMIT),
    supabase
      .from("payments")
      .select("amount, date")
      .eq("business_id", aiBusinessId)
      .gte("date", currentMonth.start)
      .lte("date", currentMonth.end),
    supabase
      .from("expenses")
      .select("total, date")
      .eq("business_id", aiBusinessId)
      .gte("date", currentMonth.start)
      .lte("date", currentMonth.end),
    supabase
      .from("payments")
      .select("amount, date")
      .eq("business_id", aiBusinessId)
      .gte("date", lastMonth.start)
      .lte("date", lastMonth.end),
    supabase
      .from("expenses")
      .select("total, date")
      .eq("business_id", aiBusinessId)
      .gte("date", lastMonth.start)
      .lte("date", lastMonth.end),
  ])

  if (
    transactionsResult.error ||
    invoicesResult.error ||
    billsResult.error ||
    customersResult.error ||
    suppliersResult.error ||
    accountsResult.error ||
    accountLinesResult.error ||
    businessProfileResult.error ||
    serviceJobsResult.error ||
    serviceJobUsageResult.error ||
    currentMonthPaymentsResult.error ||
    currentMonthExpensesResult.error ||
    lastMonthPaymentsResult.error ||
    lastMonthExpensesResult.error
  ) {
    console.warn("ProtectedLayout: some AI context queries returned errors", {
      transactions: transactionsResult.error,
      invoices: invoicesResult.error,
      bills: billsResult.error,
      customers: customersResult.error,
      suppliers: suppliersResult.error,
      accounts: accountsResult.error,
      accountLines: accountLinesResult.error,
      businessProfile: businessProfileResult.error,
      serviceJobs: serviceJobsResult.error,
      serviceJobUsage: serviceJobUsageResult.error,
      currentMonthPayments: currentMonthPaymentsResult.error,
      currentMonthExpenses: currentMonthExpensesResult.error,
      lastMonthPayments: lastMonthPaymentsResult.error,
      lastMonthExpenses: lastMonthExpensesResult.error,
    })
  }

  const invoices = invoicesResult.data ?? []
  const bills = billsResult.data ?? []
  const customers = customersResult.data ?? []
  const suppliers = suppliersResult.data ?? []
  const accounts = accountsResult.data ?? []
  const accountLines = accountLinesResult.data ?? []
  const transactions = transactionsResult.data ?? []
  const serviceJobs = serviceJobsResult.data ?? []
  const serviceJobUsage = serviceJobUsageResult.data ?? []
  const businessProfile = businessProfileResult.data ?? {}

  const customerNameById = new Map<string, { name: string | null; email: string | null }>()
  for (const customer of customers as Record<string, unknown>[]) {
    customerNameById.set(String(customer.id), {
      name: (customer.name as string | null) || null,
      email: (customer.email as string | null) || null,
    })
  }

  const supplierNameById = new Map<string, { name: string | null }>()
  for (const supplier of suppliers as Record<string, unknown>[]) {
    supplierNameById.set(String(supplier.id), {
      name: (supplier.name as string | null) || null,
    })
  }

  const accountLabelById = new Map<string, string>()
  for (const account of accounts as Record<string, unknown>[]) {
    accountLabelById.set(
      String(account.id),
      `${account.code || "N/A"} - ${account.name || "Account"}`
    )
  }

  const accountBalanceById = new Map<string, number>()
  for (const line of accountLines as Record<string, unknown>[]) {
    const accountId = String(line.account_id || "")
    if (!accountId) continue
    const debit = Number(line.debit) || 0
    const credit = Number(line.credit) || 0
    accountBalanceById.set(accountId, (accountBalanceById.get(accountId) || 0) + debit - credit)
  }

  const transactionRows = (transactions as Record<string, unknown>[]).map((entry) => {
    const lines = Array.isArray(entry.journal_entry_lines)
      ? (entry.journal_entry_lines as Record<string, unknown>[])
      : []
    const totalDebits = lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0)
    const totalCredits = lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0)
    const primaryLine = [...lines].sort((a, b) => {
      const aValue = Math.max(Number(a.debit) || 0, Number(a.credit) || 0)
      const bValue = Math.max(Number(b.debit) || 0, Number(b.credit) || 0)
      return bValue - aValue
    })[0]
    const accountLabel = primaryLine?.account_id
      ? accountLabelById.get(String(primaryLine.account_id)) || "Unmapped account"
      : "Unmapped account"

    return {
      id: entry.id,
      date: entry.date || entry.created_at || null,
      description: entry.description ? String(entry.description).slice(0, 200) : "Journal entry",
      amount: roundMoney(Math.max(totalDebits, totalCredits)),
      type: entry.reference_type || "journal_entry",
      account: accountLabel,
    }
  })

  const invoiceAmountByCustomerId = new Map<string, number>()
  for (const invoice of invoices as Record<string, unknown>[]) {
    const customerId = invoice.customer_id ? String(invoice.customer_id) : ""
    if (!customerId) continue
    const total = Number(invoice.total) || 0
    invoiceAmountByCustomerId.set(customerId, (invoiceAmountByCustomerId.get(customerId) || 0) + total)
  }

  const billAmountBySupplierId = new Map<string, number>()
  for (const bill of bills as Record<string, unknown>[]) {
    const supplierId = bill.supplier_id ? String(bill.supplier_id) : ""
    if (!supplierId) continue
    const total = Number(bill.total) || Number(bill.amount) || 0
    billAmountBySupplierId.set(supplierId, (billAmountBySupplierId.get(supplierId) || 0) + total)
  }

  const invoiceRows = (invoices as Record<string, unknown>[]).map((invoice) => {
    const customer =
      customerNameById.get(String(invoice.customer_id || "")) || {
        name: null,
        email: null,
      }
    return {
      id: invoice.id,
      customer: customer.name || "Unknown customer",
      amount: roundMoney(Number(invoice.total) || 0),
      status: invoice.status || "unknown",
      due_date: invoice.due_date || null,
    }
  })

  const billRows = (bills as Record<string, unknown>[]).map((bill) => {
    const supplier =
      supplierNameById.get(String(bill.supplier_id || "")) || { name: null }
    return {
      id: bill.id,
      supplier: supplier.name || "Unknown supplier",
      amount: roundMoney(Number(bill.total) || Number(bill.amount) || 0),
      status: bill.status || "unknown",
      due_date: bill.due_date || null,
    }
  })

  const customerRows = (customers as Record<string, unknown>[]).map((customer) => ({
    id: customer.id,
    name: customer.name || "Unknown customer",
    email: customer.email || null,
    total_billed: roundMoney(invoiceAmountByCustomerId.get(String(customer.id)) || 0),
  }))

  const supplierRows = (suppliers as Record<string, unknown>[]).map((supplier) => ({
    id: supplier.id,
    name: supplier.name || "Unknown supplier",
    total_billed: roundMoney(billAmountBySupplierId.get(String(supplier.id)) || 0),
  }))

  const accountsRows = (accounts as Record<string, unknown>[]).map((account) => ({
    id: account.id,
    code: account.code || null,
    name: account.name || "Unnamed account",
    type: account.type || null,
    sub_type: account.sub_type || null,
    balance: roundMoney(accountBalanceById.get(String(account.id)) || 0),
  }))

  const usageTotalByJobId = new Map<string, number>()
  for (const usage of serviceJobUsage as Record<string, unknown>[]) {
    const jobId = String(usage.job_id || "")
    if (!jobId) continue
    usageTotalByJobId.set(jobId, (usageTotalByJobId.get(jobId) || 0) + (Number(usage.total_cost) || 0))
  }

  const serviceJobRows = (serviceJobs as Record<string, unknown>[]).map((job) => {
    const inferredAmount =
      Number(job.amount) ||
      Number(job.total_amount) ||
      Number(job.quoted_amount) ||
      Number(job.total) ||
      usageTotalByJobId.get(String(job.id)) ||
      0

    return {
      id: job.id,
      status: job.status || "unknown",
      assigned_staff:
        job.assigned_staff_id ||
        job.staff_id ||
        job.technician_id ||
        job.assigned_to ||
        null,
      amount: roundMoney(inferredAmount),
    }
  })

  const currentIncome = roundMoney(
    (currentMonthPaymentsResult.data ?? []).reduce(
      (sum, row: { amount?: unknown }) => sum + (Number(row.amount) || 0),
      0
    )
  )
  const currentExpenses = roundMoney(
    (currentMonthExpensesResult.data ?? []).reduce(
      (sum, row: { total?: unknown }) => sum + (Number(row.total) || 0),
      0
    )
  )
  const lastIncome = roundMoney(
    (lastMonthPaymentsResult.data ?? []).reduce(
      (sum, row: { amount?: unknown }) => sum + (Number(row.amount) || 0),
      0
    )
  )
  const lastExpenses = roundMoney(
    (lastMonthExpensesResult.data ?? []).reduce(
      (sum, row: { total?: unknown }) => sum + (Number(row.total) || 0),
      0
    )
  )

  const unpaidInvoiceStatuses = new Set(["sent", "partial", "overdue", "unpaid"])
  const unpaidBillStatuses = new Set(["pending", "partial", "overdue", "unpaid", "approved"])

  const unpaidInvoicesTotal = roundMoney(
    (invoices as Record<string, unknown>[]).reduce((sum, invoice) => {
      const status = String(invoice.status || "").toLowerCase()
      const openAmount =
        Number(invoice.balance_due) ||
        Number(invoice.amount_due) ||
        Number(invoice.total) ||
        0
      if (!unpaidInvoiceStatuses.has(status)) return sum
      return sum + openAmount
    }, 0)
  )

  const unpaidBillsTotal = roundMoney(
    (bills as Record<string, unknown>[]).reduce((sum, bill) => {
      const status = String(bill.status || "").toLowerCase()
      const openAmount =
        Number(bill.balance_due) ||
        Number(bill.amount_due) ||
        Number(bill.total) ||
        Number(bill.amount) ||
        0
      if (!unpaidBillStatuses.has(status)) return sum
      return sum + openAmount
    }, 0)
  )

  const whtSettings = Object.fromEntries(
    Object.entries(businessProfile as Record<string, unknown>).filter(([key]) => {
      const lowered = key.toLowerCase()
      return lowered.includes("wht") || lowered.includes("withholding")
    })
  )

  /** Internal: assistant uses sampled rows; COA balances are from recent journal lines only */
  const builtLimitedSamplingContext = {
    generated_at: new Date().toISOString(),
    business_id: aiBusinessId,
    page_scope: "global",
    transactions: {
      label: `Recent journal activity (latest ${JE_HEADER_LIMIT} entries)`,
      count: transactionRows.length,
      total_amount: roundMoney(transactionRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
      rows: transactionRows,
    },
    invoices: {
      label: `Recent invoices (latest ${INV_LIMIT})`,
      count: invoiceRows.length,
      total_amount: roundMoney(invoiceRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
      rows: invoiceRows,
    },
    bills: {
      label: `Recent bills (latest ${BILL_LIMIT})`,
      count: billRows.length,
      total_amount: roundMoney(billRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
      rows: billRows,
    },
    customers: {
      label: `Customers (latest ${CUSTOMER_LIMIT} by created_at)`,
      count: customerRows.length,
      total_billed: roundMoney(customerRows.reduce((sum, row) => sum + (Number(row.total_billed) || 0), 0)),
      rows: customerRows,
    },
    suppliers: {
      label: `Suppliers (latest ${SUPPLIER_LIMIT} by created_at)`,
      count: supplierRows.length,
      total_billed: roundMoney(supplierRows.reduce((sum, row) => sum + (Number(row.total_billed) || 0), 0)),
      rows: supplierRows,
    },
    accounts: {
      label:
        "Chart of accounts (balances approximate — from recent journal lines sample, not full GL)",
      count: accountsRows.length,
      net_balance: roundMoney(accountsRows.reduce((sum, row) => sum + (Number(row.balance) || 0), 0)),
      rows: accountsRows,
    },
    tax_profile: {
      label: "Business tax profile",
      vat_scheme: (businessProfile as Record<string, unknown>).vat_scheme || null,
      cit_rate: (businessProfile as Record<string, unknown>).cit_rate_code || null,
      wht_settings: whtSettings,
    },
    service_jobs: {
      label: `Recent service jobs (latest ${SERVICE_JOB_LIMIT})`,
      count: serviceJobRows.length,
      total_amount: roundMoney(serviceJobRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
      rows: serviceJobRows,
    },
    monthly_summary: {
      label: "Current and last month financial summary",
      current_month: {
        period_start: currentMonth.start,
        period_end: currentMonth.end,
        total_income: currentIncome,
        total_expenses: currentExpenses,
        net_profit: roundMoney(currentIncome - currentExpenses),
      },
      last_month: {
        period_start: lastMonth.start,
        period_end: lastMonth.end,
        total_income: lastIncome,
        total_expenses: lastExpenses,
        net_profit: roundMoney(lastIncome - lastExpenses),
      },
    },
    unpaid_invoices_total: {
      label: "Outstanding receivables (from sampled recent invoices subset)",
      amount: unpaidInvoicesTotal,
    },
    unpaid_bills_total: {
      label: "Outstanding payables (from sampled recent bills subset)",
      amount: unpaidBillsTotal,
    },
  }

  return builtLimitedSamplingContext
}
