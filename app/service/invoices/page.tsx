"use client"

import { useEffect, useState, useRef, Suspense, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { useToast } from "@/components/ui/ToastProvider"
import { exportToCSV, exportToExcel, ExportColumn, formatDate } from "@/lib/exportUtils"
import { getGhanaLegacyView } from "@/lib/taxes/readTaxLines"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { DEFAULT_PLATFORM_CURRENCY_CODE } from "@/lib/currency"
import { formatMoney, formatMoneyWithSymbol } from "@/lib/money"
import { buildServiceRoute } from "@/lib/service/routes"
import { MenuSelect } from "@/components/ui/MenuSelect"
import { KpiStatCard } from "@/components/ui/KpiStatCard"

function devInvoiceTiming(label: string, startedAt: number) {
  if (process.env.NODE_ENV === "production") return
  console.info(`[service/invoices] ${label}: ${(performance.now() - startedAt).toFixed(1)}ms`)
}

type CustomerOption = { id: string; name: string }

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
  /** Present for CSV/Excel export VAT breakdown; optional when older rows lack JSON. */
  tax_lines?: unknown
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
  return formatMoney(amount, businessCurrencyCode ?? DEFAULT_PLATFORM_CURRENCY_CODE)
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

function InvoicesPageSkeleton() {
  const pulse = "animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-700/50"
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className={`h-8 w-40 ${pulse}`} />
            <div className={`h-4 w-56 ${pulse}`} />
          </div>
          <div className="flex gap-2">
            <div className={`h-10 w-24 ${pulse}`} />
            <div className={`h-10 w-28 ${pulse}`} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
              <div className={`h-4 w-24 ${pulse}`} />
              <div className={`h-8 w-36 ${pulse}`} />
              <div className={`h-3 w-32 ${pulse}`} />
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className={`h-11 ${pulse}`} />
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-3.5 flex gap-6 flex-wrap">
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className={`h-3 w-14 ${pulse}`} />
            ))}
          </div>
          {[1, 2, 3, 4, 5, 6].map((row) => (
            <div key={row} className="flex items-center gap-5 px-5 py-4 border-b border-slate-100">
              <div className={`h-4 w-28 ${pulse}`} />
              <div className={`h-4 flex-1 max-w-[140px] ${pulse}`} />
              <div className={`h-4 w-20 ml-auto ${pulse}`} />
              <div className={`h-6 w-20 ${pulse}`} />
              <div className={`h-4 w-24 ${pulse}`} />
              <div className={`h-4 w-24 ${pulse}`} />
              <div className={`h-8 w-16 ml-auto ${pulse}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
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
  const [customers, setCustomers] = useState<CustomerOption[]>([])
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const isInitialLoadRef = useRef(true)
  const businessIdRef = useRef("")
  const skipFilterEffectOnce = useRef(true)

  useEffect(() => {
    businessIdRef.current = businessId
  }, [businessId])

  const resolveAuthBusiness = useCallback(async () => {
    const tAuth = performance.now()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false as const, error: "Not logged in" }
    const business = await getCurrentBusiness(supabase, user.id)
    devInvoiceTiming("auth+business resolution", tAuth)
    if (!business) return { ok: false as const, error: "Business not found" }
    return { ok: true as const, business }
  }, [])

  const buildInvoiceListParams = useCallback(
    (bid: string) => {
      const params = new URLSearchParams()
      // Server cannot read client workspace; pass explicit scope so the list matches totals for the selected business.
      params.append("business_id", bid)
      if (statusFilter !== "all") params.append("status", statusFilter)
      if (customerFilter !== "all") params.append("customer_id", customerFilter)
      if (startDate) params.append("start_date", startDate)
      if (endDate) params.append("end_date", endDate)
      if (searchQuery) params.append("search", searchQuery)
      return params
    },
    [statusFilter, customerFilter, startDate, endDate, searchQuery]
  )

  const fetchInvoiceList = useCallback(
    async (bid: string): Promise<Invoice[]> => {
      const params = buildInvoiceListParams(bid)
      const t0 = performance.now()
      const res = await fetch(`/api/invoices/list?${params.toString()}`)
      devInvoiceTiming("invoices API load", t0)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load invoices")
      const { invoices: data } = await res.json()
      return data || []
    },
    [buildInvoiceListParams]
  )

  const reloadInvoicesOnly = useCallback(async () => {
    const bid = businessIdRef.current
    if (!bid) return
    try {
      const data = await fetchInvoiceList(bid)
      setInvoices(data)
      setTotalInvoices(data.length)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load invoices")
    }
  }, [fetchInvoiceList])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError("")
      const resolved = await resolveAuthBusiness()
      if (cancelled) return
      if (!resolved.ok) {
        setError(resolved.error)
        setLoading(false)
        isInitialLoadRef.current = false
        return
      }
      const bid = resolved.business.id
      setBusinessId(bid)

      try {
        const customersPromise = (async () => {
          const t0 = performance.now()
          const { data } = await supabase
            .from("customers")
            .select("id, name")
            .eq("business_id", bid)
            .is("deleted_at", null)
            .order("name")
          devInvoiceTiming("customers load", t0)
          return data || []
        })()

        const invoicesPromise = (async () => {
          const params = buildInvoiceListParams(bid)
          const t0 = performance.now()
          const res = await fetch(`/api/invoices/list?${params.toString()}`)
          devInvoiceTiming("invoices API load", t0)
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load invoices")
          const { invoices: data } = await res.json()
          return (data || []) as Invoice[]
        })()

        const [custRows, invData] = await Promise.all([customersPromise, invoicesPromise])
        if (cancelled) return
        setCustomers(custRows)
        setInvoices(invData)
        setTotalInvoices(invData.length)
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load invoices")
      } finally {
        if (!cancelled) {
          setLoading(false)
          isInitialLoadRef.current = false
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // One-shot mount: filter-driven reloads use reloadInvoicesOnly. Intentionally freeze first-query params to initial render state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveAuthBusiness])

  useEffect(() => {
    const handleFocus = () => {
      if (isInitialLoadRef.current) return
      void (async () => {
        const before = businessIdRef.current
        const resolved = await resolveAuthBusiness()
        if (!resolved.ok) return
        const bid = resolved.business.id
        if (bid !== before) {
          skipFilterEffectOnce.current = true
          setBusinessId(bid)
          const t0 = performance.now()
          const { data } = await supabase
            .from("customers")
            .select("id, name")
            .eq("business_id", bid)
            .is("deleted_at", null)
            .order("name")
          devInvoiceTiming("customers load", t0)
          setCustomers(data || [])
        }
        try {
          const data = await fetchInvoiceList(bid)
          setInvoices(data)
          setTotalInvoices(data.length)
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : "Failed to load invoices")
        }
      })()
    }
    window.addEventListener("focus", handleFocus)
    return () => window.removeEventListener("focus", handleFocus)
  }, [resolveAuthBusiness, fetchInvoiceList])

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    if (searchInput.trim()) setIsSearching(true)
    searchDebounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput)
      setIsSearching(false)
    }, 300)
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [searchInput])

  useEffect(() => {
    if (!businessId) return
    if (skipFilterEffectOnce.current) {
      skipFilterEffectOnce.current = false
      return
    }
    void reloadInvoicesOnly()
  }, [businessId, statusFilter, customerFilter, startDate, endDate, searchQuery, reloadInvoicesOnly])

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
      const t0 = performance.now()
      const { data } = await supabase.from("payments").select("amount").eq("business_id", businessId).is("deleted_at", null)
      devInvoiceTiming("revenue/payment totals load", t0)
      setTotalRevenue(data?.reduce((s, p) => s + Number(p.amount), 0) || 0)
    }
    void calc()
  }, [businessId])

  useEffect(() => {
    const calc = async () => {
      if (!businessId || !invoices.length) {
        setOutstandingAmount(0)
        return
      }
      const open = invoices.filter((i) => ["sent", "overdue", "partially_paid"].includes(i.status))
      if (!open.length) {
        setOutstandingAmount(0)
        return
      }
      const t0 = performance.now()
      const { payments, creditNotes } = await fetchPaymentTotals(open.map((i) => i.id))
      devInvoiceTiming("outstanding totals load", t0)
      setOutstandingAmount(
        open.reduce(
          (s, inv) => s + Math.max(0, Number(inv.total) - (payments[inv.id] || 0) - (creditNotes[inv.id] || 0)),
          0
        )
      )
    }
    void calc()
  }, [businessId, invoices])

  const handleExportCSV = async () => {
    if (!invoices.length) { toast.showToast("No invoices to export", "error"); return }
    const { payments, creditNotes } = await fetchPaymentTotals(invoices.map(i => i.id))
    const rows = invoices.map(inv => {
      const { vat } = getGhanaLegacyView(inv.tax_lines)
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
      const { vat } = getGhanaLegacyView(inv.tax_lines)
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
    return <InvoicesPageSkeleton />
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiStatCard
            layout="header"
            label="Total Revenue"
            icon={<svg className="h-4 w-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3v18h18M7 15l3-3 3 2 4-5" /></svg>}
            iconWrapperClassName="bg-emerald-50"
            value={formatWithCode(totalRevenue)}
            valueVariant="currency"
            hint="Payments received"
          />
          <KpiStatCard
            layout="header"
            label="Outstanding"
            icon={<svg className="h-4 w-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
            iconWrapperClassName="bg-amber-50"
            value={format(outstandingAmount)}
            valueVariant="currency"
            hint="Awaiting payment"
          />
          <KpiStatCard
            layout="header"
            label="Invoices"
            icon={<svg className="h-4 w-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
            iconWrapperClassName="bg-blue-50"
            value={totalInvoices}
            hint={
              <>
                {invoices.filter((i) => i.status === "paid").length} paid ·{" "}
                {invoices.filter((i) => invoiceIsPastDueOpen(i)).length} overdue
              </>
            }
          />
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
            <MenuSelect
              value={statusFilter}
              onValueChange={setStatusFilter}
              options={[
                { value: "all", label: "All Status" },
                { value: "draft", label: "Draft" },
                { value: "sent", label: "Sent" },
                { value: "partially_paid", label: "Partially Paid" },
                { value: "paid", label: "Paid" },
                { value: "overdue", label: "Overdue" },
                { value: "cancelled", label: "Cancelled" },
              ]}
            />

            {/* Customer */}
            <MenuSelect
              value={customerFilter}
              onValueChange={setCustomerFilter}
              options={[
                { value: "all", label: "All Customers" },
                ...customers.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />

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
    <Suspense fallback={<InvoicesPageSkeleton />}>
      <InvoicesPageContent />
    </Suspense>
  )
}
