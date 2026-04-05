"use client"

import { useEffect, useState, useRef, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { useToast } from "@/components/ui/ToastProvider"
import { exportToCSV, exportToExcel, ExportColumn, formatDate } from "@/lib/exportUtils"
import { getGhanaLegacyView } from "@/lib/taxes/readTaxLines"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { formatMoney, formatMoneyWithSymbol } from "@/lib/money"
import { buildServiceRoute } from "@/lib/service/routes"
import { NativeSelect } from "@/components/ui/NativeSelect"

type Invoice = {
  id: string
  invoice_number: string
  customer_id: string | null
  customers: { id: string; name: string; email: string | null } | null
  subtotal?: number
  vat?: number
  total: number
  /** Issued invoice currency (FX invoices differ from business home currency). */
  currency_code?: string | null
  currency_symbol?: string | null
  status: "draft" | "sent" | "partially_paid" | "partial" | "paid" | "overdue" | "cancelled"
  issue_date: string | null
  due_date: string | null
  created_at: string
}

/** Format a list-row total using the currency stored on the invoice (same as invoice view). */
function formatInvoiceListAmount(
  amount: number,
  inv: Pick<Invoice, "currency_code" | "currency_symbol">,
  businessCurrencyCode: string | null
): string {
  const code = inv.currency_code?.trim() || null
  if (code) return formatMoney(amount, code)
  const sym = inv.currency_symbol?.trim()
  if (sym) return formatMoneyWithSymbol(amount, sym)
  return formatMoney(amount, businessCurrencyCode)
}

const STATUS_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  draft:          { label: "Draft",          dot: "bg-slate-400",   bg: "bg-slate-100",   text: "text-slate-600" },
  sent:           { label: "Sent",           dot: "bg-blue-500",    bg: "bg-blue-50",     text: "text-blue-700" },
  partially_paid: { label: "Partial",        dot: "bg-amber-500",   bg: "bg-amber-50",    text: "text-amber-700" },
  paid:           { label: "Paid",           dot: "bg-emerald-600", bg: "bg-emerald-100",  text: "text-emerald-800" },
  overdue:        { label: "Overdue",        dot: "bg-red-600",     bg: "bg-red-100",      text: "text-red-800" },
  cancelled:      { label: "Cancelled",      dot: "bg-slate-300",   bg: "bg-slate-50",    text: "text-slate-400" },
}

/** Past calendar due date and still open — DB often keeps `sent` / `partially_paid` instead of `overdue`. */
function invoiceIsPastDueOpen(invoice: Pick<Invoice, "status" | "due_date">): boolean {
  const s = (invoice.status || "").toLowerCase()
  if (s === "overdue") return true
  if (!invoice.due_date) return false
  if (s === "paid" || s === "draft" || s === "cancelled" || s === "void") return false
  const due = String(invoice.due_date).split("T")[0]
  const t = new Date()
  const todayStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`
  return due < todayStr
}

function statusForListBadge(invoice: Invoice): string {
  if (invoiceIsPastDueOpen(invoice)) return "overdue"
  const s = invoice.status
  if (s === "partial") return "partially_paid"
  return s
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

function fmt(dateString: string | null) {
  if (!dateString) return "—"
  return new Date(dateString).toLocaleDateString("en-GH", { year: "numeric", month: "short", day: "numeric" })
}

function InvoicesPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const { format, formatWithCode, currencyCode: businessCurrencyCode } =
    useBusinessCurrency()

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [totalRevenue, setTotalRevenue] = useState(0)
  const [outstandingAmount, setOutstandingAmount] = useState(0)
  const [totalInvoices, setTotalInvoices] = useState(0)

  const [statusFilter, setStatusFilter] = useState<string>(() => searchParams.get("status") || "all")
  const [customerFilter, setCustomerFilter] = useState("all")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [customers, setCustomers] = useState<any[]>([])
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const isInitialLoadRef = useRef(true)

  useEffect(() => { loadCustomers(); loadInvoices() }, [])

  useEffect(() => {
    const handleFocus = () => { if (businessId && !isInitialLoadRef.current) loadInvoices() }
    window.addEventListener("focus", handleFocus)
    return () => window.removeEventListener("focus", handleFocus)
  }, [businessId])

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    if (searchInput.trim()) setIsSearching(true)
    searchDebounceRef.current = setTimeout(() => { setSearchQuery(searchInput); setIsSearching(false) }, 300)
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current) }
  }, [searchInput])

  useEffect(() => { if (businessId) loadInvoices() }, [businessId, statusFilter, customerFilter, startDate, endDate, searchQuery])

  const loadCustomers = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) return
      const { data } = await supabase.from("customers").select("id, name").eq("business_id", business.id).is("deleted_at", null).order("name")
      setCustomers(data || [])
    } catch {}
  }

  const loadInvoices = async () => {
    try {
      if (isInitialLoadRef.current) setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError("Not logged in"); setLoading(false); return }
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) { setError("Business not found"); setLoading(false); return }
      setBusinessId(business.id)

      const params = new URLSearchParams()
      // Server getCurrentBusiness() cannot read localStorage workspace; pass explicit scope
      // so the list matches client-side totals (payments, etc.) for the selected business.
      params.append("business_id", business.id)
      if (statusFilter !== "all") params.append("status", statusFilter)
      if (customerFilter !== "all") params.append("customer_id", customerFilter)
      if (startDate) params.append("start_date", startDate)
      if (endDate) params.append("end_date", endDate)
      if (searchQuery) params.append("search", searchQuery)

      const res = await fetch(`/api/invoices/list?${params.toString()}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load invoices")
      const { invoices: data } = await res.json()
      setInvoices(data || [])
      setTotalInvoices(data?.length || 0)
      setLoading(false)
      isInitialLoadRef.current = false
    } catch (err: any) {
      setError(err.message || "Failed to load invoices")
      setLoading(false)
      isInitialLoadRef.current = false
    }
  }

  const fetchPaymentTotals = async (ids: string[]) => {
    if (!ids.length) return { payments: {} as Record<string, number>, creditNotes: {} as Record<string, number> }
    const [{ data: pays }, { data: cns }] = await Promise.all([
      supabase.from("payments").select("invoice_id, amount").in("invoice_id", ids).is("deleted_at", null),
      supabase.from("credit_notes").select("invoice_id, total").in("invoice_id", ids).eq("status", "applied").is("deleted_at", null),
    ])
    const payments: Record<string, number> = {}
    pays?.forEach(p => { payments[p.invoice_id] = (payments[p.invoice_id] || 0) + Number(p.amount) })
    const creditNotes: Record<string, number> = {}
    cns?.forEach(cn => { creditNotes[cn.invoice_id] = (creditNotes[cn.invoice_id] || 0) + Number(cn.total) })
    return { payments, creditNotes }
  }

  useEffect(() => {
    const calc = async () => {
      if (!businessId) return
      const { data } = await supabase.from("payments").select("amount").eq("business_id", businessId).is("deleted_at", null)
      setTotalRevenue(data?.reduce((s, p) => s + Number(p.amount), 0) || 0)
    }
    calc()
  }, [businessId])

  useEffect(() => {
    const calc = async () => {
      if (!businessId || !invoices.length) { setOutstandingAmount(0); return }
      const open = invoices.filter(i => ["sent", "overdue", "partially_paid"].includes(i.status))
      if (!open.length) { setOutstandingAmount(0); return }
      const { payments, creditNotes } = await fetchPaymentTotals(open.map(i => i.id))
      setOutstandingAmount(open.reduce((s, inv) => s + Math.max(0, Number(inv.total) - (payments[inv.id] || 0) - (creditNotes[inv.id] || 0)), 0))
    }
    calc()
  }, [businessId, invoices])

  const handleExportCSV = async () => {
    if (!invoices.length) { toast.showToast("No invoices to export", "error"); return }
    const { payments, creditNotes } = await fetchPaymentTotals(invoices.map(i => i.id))
    const rows = invoices.map(inv => {
      const { vat } = getGhanaLegacyView((inv as any).tax_lines)
      return { ...inv, amountPaid: payments[inv.id] || 0, credits: creditNotes[inv.id] || 0, outstanding: Math.max(0, Number(inv.total) - (payments[inv.id] || 0) - (creditNotes[inv.id] || 0)), subtotal: Number(inv.subtotal || 0), vat: vat || inv.vat || 0, total: Number(inv.total) }
    })
    const cols: ExportColumn<typeof rows[0]>[] = [
      { header: "Invoice #", accessor: i => i.invoice_number || "", width: 20 },
      { header: "Date", accessor: i => formatDate(i.issue_date), width: 15 },
      { header: "Due Date", accessor: i => formatDate(i.due_date), width: 15 },
      { header: "Customer", accessor: i => i.customers?.name || "", width: 30 },
      { header: "Currency", accessor: i => i.currency_code?.trim() || businessCurrencyCode || "", width: 10 },
      { header: "Status", accessor: i => i.status.replace(/_/g, " "), width: 15 },
      {
        header: "Subtotal",
        accessor: i => i.subtotal,
        formatter: (v, i) => formatInvoiceListAmount(Number(v), i, businessCurrencyCode),
        excelType: "string",
        width: 16,
      },
      {
        header: "VAT",
        accessor: i => i.vat,
        formatter: (v, i) => formatInvoiceListAmount(Number(v), i, businessCurrencyCode),
        excelType: "string",
        width: 14,
      },
      {
        header: "Total",
        accessor: i => i.total,
        formatter: (v, i) => formatInvoiceListAmount(Number(v), i, businessCurrencyCode),
        excelType: "string",
        width: 16,
      },
      {
        header: "Paid",
        accessor: i => i.amountPaid,
        formatter: (v, i) => formatInvoiceListAmount(Number(v), i, businessCurrencyCode),
        excelType: "string",
        width: 16,
      },
      {
        header: "Outstanding",
        accessor: i => i.outstanding,
        formatter: (v, i) => formatInvoiceListAmount(Number(v), i, businessCurrencyCode),
        excelType: "string",
        width: 16,
      },
    ]
    exportToCSV(rows, cols, "invoices")
    toast.showToast("Exported to CSV", "success")
  }

  const handleExportExcel = async () => {
    if (!invoices.length) { toast.showToast("No invoices to export", "error"); return }
    const { payments, creditNotes } = await fetchPaymentTotals(invoices.map(i => i.id))
    const rows = invoices.map(inv => {
      const { vat } = getGhanaLegacyView((inv as any).tax_lines)
      return { ...inv, amountPaid: payments[inv.id] || 0, credits: creditNotes[inv.id] || 0, outstanding: Math.max(0, Number(inv.total) - (payments[inv.id] || 0) - (creditNotes[inv.id] || 0)), subtotal: Number(inv.subtotal || 0), vat: vat || inv.vat || 0, total: Number(inv.total) }
    })
    const cols: ExportColumn<typeof rows[0]>[] = [
      { header: "Invoice #", accessor: i => i.invoice_number || "", width: 20 },
      { header: "Date", accessor: i => i.issue_date || "", formatter: v => v ? formatDate(v) : "", excelType: "date", width: 15 },
      { header: "Due Date", accessor: i => i.due_date || "", formatter: v => v ? formatDate(v) : "", excelType: "date", width: 15 },
      { header: "Customer", accessor: i => i.customers?.name || "", width: 30 },
      { header: "Currency", accessor: i => i.currency_code?.trim() || businessCurrencyCode || "", width: 10 },
      { header: "Status", accessor: i => i.status.replace(/_/g, " "), width: 15 },
      {
        header: "Subtotal",
        accessor: i => i.subtotal,
        formatter: (v, i) => formatInvoiceListAmount(Number(v), i, businessCurrencyCode),
        excelType: "string",
        width: 16,
      },
      {
        header: "VAT",
        accessor: i => i.vat,
        formatter: (v, i) => formatInvoiceListAmount(Number(v), i, businessCurrencyCode),
        excelType: "string",
        width: 14,
      },
      {
        header: "Total",
        accessor: i => i.total,
        formatter: (v, i) => formatInvoiceListAmount(Number(v), i, businessCurrencyCode),
        excelType: "string",
        width: 16,
      },
      {
        header: "Paid",
        accessor: i => i.amountPaid,
        formatter: (v, i) => formatInvoiceListAmount(Number(v), i, businessCurrencyCode),
        excelType: "string",
        width: 16,
      },
      {
        header: "Outstanding",
        accessor: i => i.outstanding,
        formatter: (v, i) => formatInvoiceListAmount(Number(v), i, businessCurrencyCode),
        excelType: "string",
        width: 16,
      },
    ]
    await exportToExcel(rows, cols, "invoices")
    toast.showToast("Exported to Excel", "success")
  }

  const clearFilters = () => { setStatusFilter("all"); setCustomerFilter("all"); setStartDate(""); setEndDate(""); setSearchInput(""); setSearchQuery("") }
  const hasFilters = statusFilter !== "all" || customerFilter !== "all" || startDate || endDate || searchInput

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-500 mt-3 text-sm">Loading invoices…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Invoices</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {totalInvoices} invoice{totalInvoices !== 1 ? "s" : ""}
              {hasFilters ? " matching filters" : " total"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {invoices.length > 0 && (
              <>
                <button onClick={handleExportCSV} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  CSV
                </button>
                <button onClick={handleExportExcel} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  Excel
                </button>
              </>
            )}
            <button
              onClick={() => router.push("/invoices/create")}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
              New Invoice
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Revenue</span>
              <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3v18h18M7 15l3-3 3 2 4-5" /></svg>
              </div>
            </div>
            <p className="text-2xl font-bold text-slate-900 tabular-nums">
              {formatWithCode(totalRevenue)}
            </p>
            <p className="text-xs text-slate-400 mt-1">Payments received</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Outstanding</span>
              <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
            </div>
            <p className="text-2xl font-bold text-slate-900">{format(outstandingAmount)}</p>
            <p className="text-xs text-slate-400 mt-1">Awaiting payment</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Invoices</span>
              <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              </div>
            </div>
            <p className="text-2xl font-bold text-slate-900">{totalInvoices}</p>
            <p className="text-xs text-slate-400 mt-1">
              {invoices.filter(i => i.status === "paid").length} paid · {invoices.filter(i => invoiceIsPastDueOpen(i)).length} overdue
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Search */}
            <div className="sm:col-span-2 lg:col-span-1 relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Search invoices…"
                className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {isSearching && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />}
            </div>

            {/* Status */}
            <NativeSelect value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">All Status</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="partially_paid">Partially Paid</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
              <option value="cancelled">Cancelled</option>
            </NativeSelect>

            {/* Customer */}
            <NativeSelect value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}>
              <option value="all">All Customers</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>

            {/* Start date */}
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />

            {/* End date */}
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          {hasFilters && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <button onClick={clearFilters} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 font-medium transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                Clear filters
              </button>
            </div>
          )}
        </div>

        {/* Table */}
        {invoices.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-16 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </div>
            <p className="text-slate-600 font-semibold text-lg">No invoices found</p>
            <p className="text-slate-400 text-sm mt-1 mb-6">
              {hasFilters ? "Try adjusting your filters" : "Create your first invoice to get started"}
            </p>
            {!hasFilters && (
              <button onClick={() => router.push("/invoices/create")} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                Create Invoice
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70">
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">Invoice</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">Customer</th>
                    <th className="px-5 py-3.5 text-right text-xs font-bold text-slate-400 uppercase tracking-wider">Amount</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">Status</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">Issued</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">Due</th>
                    <th className="px-5 py-3.5 text-right text-xs font-bold text-slate-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoices.map(invoice => {
                    const isOverdue = invoiceIsPastDueOpen(invoice)
                    const isPaid = invoice.status === "paid"
                    const rowTint =
                      isPaid
                        ? "bg-emerald-100/90 hover:bg-emerald-200/90 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/55"
                        : isOverdue
                          ? "bg-red-100/90 hover:bg-red-200/90 dark:bg-red-950/40 dark:hover:bg-red-950/55"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    return (
                      <tr
                        key={invoice.id}
                        onClick={() =>
                          router.push(
                            buildServiceRoute(`/invoices/${invoice.id}/view`, businessId || undefined)
                          )
                        }
                        className={`cursor-pointer transition-colors group ${rowTint}`}
                      >
                        <td className="px-5 py-4">
                          <span className="text-sm font-bold text-slate-800 group-hover:text-blue-600 transition-colors">
                            {invoice.invoice_number || <span className="text-slate-400 font-normal italic">Draft</span>}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <span className="text-sm text-slate-700">{invoice.customers?.name || <span className="text-slate-400 italic">No customer</span>}</span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <span className="text-sm font-semibold text-slate-900 tabular-nums">
                            {formatInvoiceListAmount(Number(invoice.total || 0), invoice, businessCurrencyCode)}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge status={statusForListBadge(invoice)} />
                        </td>
                        <td className="px-5 py-4">
                          <span className="text-sm text-slate-500">{fmt(invoice.issue_date)}</span>
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className={`text-sm ${
                              isOverdue
                                ? "text-red-700 font-semibold dark:text-red-400"
                                : isPaid
                                  ? "text-emerald-800 dark:text-emerald-400"
                                  : "text-slate-500"
                            }`}
                          >
                            {fmt(invoice.due_date)}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              router.push(
                                buildServiceRoute(`/invoices/${invoice.id}/view`, businessId || undefined)
                              )
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                          >
                            View
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function InvoicesPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <InvoicesPageContent />
    </Suspense>
  )
}
