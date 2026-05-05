import type { SupabaseClient } from "@supabase/supabase-js"

type StatementFilters = {
  startDate?: string | null
  endDate?: string | null
}
type BuildCustomerStatementDataArgs = {
  supabase: SupabaseClient
  businessId: string
  customerId: string
  filters?: StatementFilters
}

export type StatementTransaction = {
  id: string
  date: string | null
  type: "invoice" | "payment" | "credit_note"
  reference: string
  description: string
  debit: number
  credit: number
  balance: number
}

export async function buildCustomerStatementData({
  supabase,
  businessId,
  customerId,
  filters,
}: BuildCustomerStatementDataArgs): Promise<{
  customer: any
  invoices: any[]
  payments: any[]
  creditNotes: any[]
  summary: {
    openingBalance: number
    totalInvoiced: number
    totalPaid: number
    totalCredits: number
    totalOutstanding: number
    totalOverdue: number
    closingBalance: number
    transactionCount: number
    invoicesByStatus: {
      draft: any[]
      sent: any[]
      partially_paid: any[]
      paid: any[]
      overdue: any[]
    }
  }
  transactions: StatementTransaction[]
}> {
  const startDate = filters?.startDate || null
  const endDate = filters?.endDate || null

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .single()

  if (customerError || !customer) {
    const err = new Error("Customer not found")
    ;(err as any).status = 404
    throw err
  }

  let invoiceQuery = supabase
    .from("invoices")
    .select("*")
    .eq("customer_id", customerId)
    .eq("business_id", businessId)
    .neq("status", "draft")
    .is("deleted_at", null)
    .order("issue_date", { ascending: true })

  if (startDate) {
    invoiceQuery = invoiceQuery.gte("issue_date", startDate)
  }
  if (endDate) {
    invoiceQuery = invoiceQuery.lte("issue_date", endDate)
  }

  const { data: invoices, error: invoicesError } = await invoiceQuery
  if (invoicesError) {
    throw new Error(invoicesError.message || "Failed to load invoices")
  }

  const invoiceIds = (invoices || []).map((inv: any) => inv.id)
  let payments: any[] = []
  let creditNotes: any[] = []

  if (invoiceIds.length > 0) {
    const { data: paymentsData, error: paymentsError } = await supabase
      .from("payments")
      .select("*")
      .in("invoice_id", invoiceIds)
      .is("deleted_at", null)
      .order("date", { ascending: true })

    if (paymentsError) {
      throw new Error(paymentsError.message || "Failed to load payments")
    }
    payments = paymentsData || []

    const { data: creditNotesData, error: creditNotesError } = await supabase
      .from("credit_notes")
      .select(
        "id, business_id, invoice_id, credit_number, date, reason, subtotal, nhil, getfund, covid, vat, total_tax, total, status, notes, public_token, created_at, updated_at, deleted_at, tax_lines, tax_engine_code, tax_engine_effective_from, tax_jurisdiction"
      )
      .in("invoice_id", invoiceIds)
      .is("deleted_at", null)
      .order("date", { ascending: true })

    if (creditNotesError) {
      throw new Error(creditNotesError.message || "Failed to load credit notes")
    }
    creditNotes = creditNotesData || []
  }

  const nonDraftInvoices = (invoices || []).filter((inv: any) => inv.status !== "draft")
  const totalInvoiced = nonDraftInvoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0)

  const nonDraftInvoiceIds = nonDraftInvoices.map((inv: any) => inv.id)
  const nonDraftPayments = payments.filter((p: any) => nonDraftInvoiceIds.includes(p.invoice_id))
  const totalPaid = nonDraftPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)

  const nonDraftCreditNotes = creditNotes.filter(
    (cn: any) => cn.status === "applied" && nonDraftInvoiceIds.includes(cn.invoice_id)
  )
  const totalCredits = nonDraftCreditNotes.reduce((sum, cn) => sum + Number(cn.total || 0), 0)

  const totalOutstanding = totalInvoiced - totalPaid - totalCredits
  const openingBalance = 0
  const closingBalance = totalOutstanding

  const today = new Date()
  const overdueInvoices = nonDraftInvoices.filter((inv: any) => {
    if (inv.status === "paid") return false
    if (!inv.due_date) return false
    const dueDate = new Date(inv.due_date)
    return today > dueDate
  })

  const totalOverdue = overdueInvoices.reduce((sum, inv) => {
    const invoiceTotal = Number(inv.total || 0)
    const invoicePayments = nonDraftPayments.filter((p) => p.invoice_id === inv.id)
    const invoicePaid = invoicePayments.reduce((s, p) => s + Number(p.amount || 0), 0)
    const invoiceCredits = nonDraftCreditNotes
      .filter((cn: any) => cn.invoice_id === inv.id)
      .reduce((s, cn) => s + Number(cn.total || 0), 0)
    const outstandingAmount = Math.max(0, invoiceTotal - invoicePaid - invoiceCredits)
    return sum + outstandingAmount
  }, 0)

  const transactionsBase: Array<{
    id: string
    date: string | null
    type: "invoice" | "payment" | "credit_note"
    reference: string
    description: string
    debit: number
    credit: number
  }> = []

  nonDraftInvoices.forEach((inv: any) => {
    transactionsBase.push({
      id: `invoice:${inv.id}`,
      date: inv.issue_date ?? null,
      type: "invoice",
      reference: inv.invoice_number ? `#${inv.invoice_number}` : "—",
      description: `Invoice ${(inv.status || "").replace(/_/g, " ") || "sent"}`,
      debit: Number(inv.total || 0),
      credit: 0,
    })
  })

  nonDraftPayments.forEach((payment: any) => {
    transactionsBase.push({
      id: `payment:${payment.id}`,
      date: payment.date ?? null,
      type: "payment",
      reference: payment.reference || "—",
      description: payment.method ? `Payment (${String(payment.method).replace(/_/g, " ")})` : "Payment",
      debit: 0,
      credit: Number(payment.amount || 0),
    })
  })

  nonDraftCreditNotes.forEach((cn: any) => {
    transactionsBase.push({
      id: `credit:${cn.id}`,
      date: cn.date ?? null,
      type: "credit_note",
      reference: cn.credit_number || "—",
      description: cn.reason || "Applied credit note",
      debit: 0,
      credit: Number(cn.total || 0),
    })
  })

  const priority: Record<"invoice" | "payment" | "credit_note", number> = {
    invoice: 0,
    payment: 1,
    credit_note: 2,
  }
  transactionsBase.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0
    const db = b.date ? new Date(b.date).getTime() : 0
    if (da !== db) return da - db
    if (priority[a.type] !== priority[b.type]) return priority[a.type] - priority[b.type]
    return a.id.localeCompare(b.id)
  })

  let runningBalance = openingBalance
  const transactions: StatementTransaction[] = transactionsBase.map((item) => {
    runningBalance += item.debit - item.credit
    return {
      ...item,
      balance: runningBalance,
    }
  })

  return {
    customer,
    invoices: invoices || [],
    payments: payments || [],
    creditNotes: creditNotes || [],
    summary: {
      openingBalance,
      totalInvoiced,
      totalPaid,
      totalCredits,
      totalOutstanding,
      totalOverdue,
      closingBalance,
      transactionCount: transactions.length,
      invoicesByStatus: {
        draft: (invoices || []).filter((inv: any) => inv.status === "draft"),
        sent: (invoices || []).filter((inv: any) => inv.status === "sent"),
        partially_paid: (invoices || []).filter((inv: any) => inv.status === "partially_paid"),
        paid: (invoices || []).filter((inv: any) => inv.status === "paid"),
        overdue: overdueInvoices,
      },
    },
    transactions,
  }
}
