"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { retailPaths } from "@/lib/retail/routes"
import { hasAccessToSalesHistory, getUserRole } from "@/lib/userRoles"
import { getActiveStoreId } from "@/lib/storeSession"
import { getEffectiveStoreIdClient } from "@/lib/storeContext"
import { useRefund } from "@/lib/hooks/useRefund"
import { formatMoney } from "@/lib/money"
import RefundModalWrapper from "@/components/RefundModalWrapper"
import {
  RetailBackofficeAlert,
  RetailBackofficeBadge,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeCardTitle,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
  RetailBackofficeSkeleton,
  retailFieldClass,
  retailLabelClass,
  RetailMenuSelect,
  type MenuSelectOption,
} from "@/components/retail/RetailBackofficeUi"

type Sale = {
  id: string
  sale_id: string
  date: string
  cashier: { id: string; name: string; email: string } | null
  register: { id: string; name: string } | null
  total_amount: number
  payment_methods: string[]
  payment_method_display: string
  status: "completed" | "voided" | "refunded" | "parked"
  session_id: string | null
  payment_breakdown: { cash: number; momo: number; card: number } | null
  foreign_currency: {
    currency: string
    amount: number
    exchange_rate: number
    converted: number
  } | null
  voided_info?: {
    voided_at: string
    supervisor: { name: string; email: string } | null
  }
}

type User = {
  id: string
  email: string
  full_name: string
}

type Register = {
  id: string
  name: string
}

const SALES_HISTORY_PAYMENT_OPTIONS: MenuSelectOption[] = [
  { value: "", label: "All methods" },
  { value: "cash", label: "Cash" },
  { value: "momo", label: "MoMo" },
  { value: "card", label: "Card" },
  { value: "split", label: "Split" },
]

const SALES_HISTORY_STATUS_OPTIONS: MenuSelectOption[] = [
  { value: "", label: "All statuses" },
  { value: "completed", label: "Completed" },
  { value: "refunded", label: "Refunded" },
  { value: "voided", label: "Voided" },
  { value: "parked", label: "Parked" },
]

export default function RetailSalesHistoryPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [currencyCode, setCurrencyCode] = useState("GHS")
  const [hasAccess, setHasAccess] = useState(false)

  // Filters - Initialize from URL params if present
  const [dateFrom, setDateFrom] = useState(searchParams?.get("date_from") || "")
  const [dateTo, setDateTo] = useState(searchParams?.get("date_to") || "")
  const [paymentMethod, setPaymentMethod] = useState("")
  const [status, setStatus] = useState("")
  const [cashierId, setCashierId] = useState("")
  const [registerId, setRegisterId] = useState("")
  const [saleSearch, setSaleSearch] = useState("")

  // Pagination
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  // Sorting
  const [sortField, setSortField] = useState<string>("date")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")

  const handleSort = (field: string) => {
    if (sortField === field) {
      // Toggle direction if clicking same field
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      // New field, default to descending
      setSortField(field)
      setSortDirection("desc")
    }
    setPage(1) // Reset to first page when sorting
  }

  const getSortIcon = (field: string) => {
    if (sortField !== field) {
      return (
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      )
    }
    if (sortDirection === "asc") {
      return (
        <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      )
    }
    return (
      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    )
  }

  // Options for filters
  const [cashiers, setCashiers] = useState<User[]>([])
  const [registers, setRegisters] = useState<Register[]>([])

  const cashierMenuOptions = useMemo(() => {
    const head: MenuSelectOption[] = [{ value: "", label: "All cashiers" }]
    return head.concat(
      cashiers.map((c) => ({ value: c.id, label: c.full_name || c.email })),
    )
  }, [cashiers])

  const registerMenuOptions = useMemo(() => {
    const head: MenuSelectOption[] = [{ value: "", label: "All registers" }]
    return head.concat(registers.map((r) => ({ value: r.id, label: r.name })))
  }, [registers])

  // Refund functionality
  const {
    requestRefund,
    showOverrideModal: showRefundModal,
    saleId: refundSaleId,
    cashierId: refundCashierId,
    handleOverrideClose: handleRefundClose,
    handleOverrideSuccess: handleRefundSuccess,
  } = useRefund({
    onSuccess: () => {
      // Reload sales after refund
      if (businessId) {
        loadSales()
      }
    },
    onError: (errorMsg) => {
      setError(errorMsg || "Supervisor approval is required to refund a sale.")
    },
  })

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    const r = searchParams?.get("register_id")
    const df = searchParams?.get("date_from")
    const dt = searchParams?.get("date_to")
    const lookup = searchParams?.get("lookup")
    if (r) setRegisterId(r)
    if (df) setDateFrom(df)
    if (dt) setDateTo(dt)
    if (lookup != null && lookup !== "") {
      setSaleSearch(lookup)
      setPage(1)
    }
  }, [searchParams])

  const lastRefundUrlSaleId = useRef<string | null>(null)
  useEffect(() => {
    const refundId = searchParams?.get("refund")?.trim() || ""
    if (!refundId) {
      lastRefundUrlSaleId.current = null
      return
    }
    if (!hasAccess || !businessId) return
    if (lastRefundUrlSaleId.current === refundId) return
    lastRefundUrlSaleId.current = refundId
    void requestRefund(refundId)
  }, [searchParams, hasAccess, businessId, requestRefund])

  useEffect(() => {
    if (businessId) {
      loadSales()
      loadCashiers()
      loadRegisters()
    }
  }, [businessId, page, dateFrom, dateTo, paymentMethod, status, cashierId, registerId, sortField, sortDirection, saleSearch])

  const loadData = async () => {
    try {
      setLoading(true)
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Not logged in")
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }

      setBusinessId(business.id)
      setCurrencyCode(business.default_currency || "GHS")

      // Retail route: service businesses should leave via retail dashboard (no Service URL from here)
      if (business.industry === "service") {
        router.push(retailPaths.dashboard)
        return
      }

      const role = await getUserRole(supabase, user.id, business.id)

      if (!role) {
        setError("Unable to determine your role for this business. Ask an owner to confirm your staff assignment.")
        setLoading(false)
        return
      }
      
      // Cashiers should be redirected to POS, not shown an error
      if (role === "cashier") {
        router.push(retailPaths.pos)
        return
      }

      // Check access - only owners, admins, and managers can access
      const access = await hasAccessToSalesHistory(supabase, user.id, business.id)
      setHasAccess(access)

      if (!access) {
        setError(`Access denied. Your role (“${role}”) cannot open sales history.`)
        setLoading(false)
        return
      }
    } catch (err: any) {
      setError(err.message || "Failed to load data")
      setLoading(false)
    }
  }

  const loadCashiers = async () => {
    if (!businessId) return

    const { data: businessUsers } = await supabase
      .from("business_users")
      .select("user_id")
      .eq("business_id", businessId)

    if (businessUsers && businessUsers.length > 0) {
      const userIds = businessUsers.map((bu) => bu.user_id)
      const { data: usersData } = await supabase
        .from("users")
        .select("id, email, full_name")
        .in("id", userIds)

      setCashiers(usersData || [])
    }
  }

  const loadRegisters = async () => {
    if (!businessId) return

    const {
      data: { user },
    } = await supabase.auth.getUser()
    
    if (!user) return
    
    // Get role and effective store_id
    const role = await getUserRole(supabase, user.id, businessId)
    const activeStoreId = getActiveStoreId()
    
    const { data: userData } = await supabase
      .from("users")
      .select("store_id")
      .eq("id", user.id)
      .maybeSingle()
    
    const effectiveStoreId = getEffectiveStoreIdClient(
      role,
      activeStoreId && activeStoreId !== 'all' ? activeStoreId : null,
      userData?.store_id || null
    )
    
    let registersQuery = supabase
      .from("registers")
      .select("id, name")
      .eq("business_id", businessId)
      .order("name", { ascending: true })
    
    // Filter by effective store_id (admin can see all if null)
    if (effectiveStoreId) {
      registersQuery = registersQuery.eq("store_id", effectiveStoreId)
    }
    
    const { data: registersData } = await registersQuery

    setRegisters(registersData || [])
  }

  const loadSales = async () => {
    if (!businessId) return

    try {
      setLoading(true)
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Not logged in")
        setLoading(false)
        return
      }

      // Get role and effective store_id
      const role = await getUserRole(supabase, user.id, businessId)
      const activeStoreId = getActiveStoreId()
      
      // Get user's assigned store_id (for managers/cashiers)
      const { data: userData } = await supabase
        .from("users")
        .select("store_id")
        .eq("id", user.id)
        .maybeSingle()
      
      // Get effective store_id based on role
      const effectiveStoreId = getEffectiveStoreIdClient(
        role,
        activeStoreId && activeStoreId !== 'all' ? activeStoreId : null,
        userData?.store_id || null
      )
      
      // For store users (manager), require store assignment
      if ((role === "manager" || role === "cashier") && !effectiveStoreId) {
        setError("You must be assigned to a store to view sales history.")
        setSales([])
        setLoading(false)
        return
      }
      
      // For admin, allow global mode (null store_id) or filter by selected store
      // Pass null for global mode, or store_id for filtered view
      const storeIdParam = effectiveStoreId || (role === "owner" || role === "admin" ? null : undefined)
      
      const params = new URLSearchParams({
        business_id: businessId,
        user_id: user.id,
        page: page.toString(),
        page_size: "50",
      })
      
      // Only add store_id if it's set (admin can work in global mode with null)
      if (storeIdParam) {
        params.append("store_id", storeIdParam)
      }

      if (dateFrom) params.append("date_from", dateFrom)
      if (dateTo) params.append("date_to", dateTo)
      if (paymentMethod) params.append("payment_method", paymentMethod)
      if (status) params.append("status", status)
      if (cashierId) params.append("cashier_id", cashierId)
      if (registerId) params.append("register_id", registerId)
      const trimmedSearch = saleSearch.trim()
      if (trimmedSearch) params.append("search", trimmedSearch)
      params.append("sort_field", sortField)
      params.append("sort_direction", sortDirection)

      const response = await fetch(`/api/sales-history/list?${params.toString()}`)
      const data = await response.json()

      if (!response.ok) {
        setError(data.error || "Failed to load sales")
        setLoading(false)
        return
      }

      setSales(data.sales || [])
      setTotalPages(data.pagination?.total_pages || 1)
      setTotalCount(data.pagination?.total || 0)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load sales")
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const getStatusBadge = (status: string) => {
    const tone: Record<string, "success" | "warning" | "danger" | "neutral"> = {
      completed: "success",
      refunded: "warning",
      voided: "danger",
      parked: "neutral",
    }
    const label = status.charAt(0).toUpperCase() + status.slice(1)
    return <RetailBackofficeBadge tone={tone[status] ?? "neutral"}>{label}</RetailBackofficeBadge>
  }

  const handleResetFilters = () => {
    setDateFrom("")
    setDateTo("")
    setPaymentMethod("")
    setStatus("")
    setCashierId("")
    setRegisterId("")
    setSaleSearch("")
    setPage(1)
  }

  const exportCurrentPageCsv = useCallback(() => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const header = ["sale_uuid", "date", "cashier", "register", "amount", "payment", "status"]
    const lines = [header.join(",")]
    for (const s of sales) {
      lines.push(
        [
          esc(s.id),
          esc(s.date),
          esc(s.cashier?.name || ""),
          esc(s.register?.name || ""),
          String(s.total_amount ?? ""),
          esc(s.payment_method_display || ""),
          esc(s.status || ""),
        ].join(","),
      )
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `sales-history-page-${page}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [sales, page])

  if (loading && sales.length === 0) {
    return (
      <RetailBackofficeShell>
        <RetailBackofficeMain className="max-w-7xl">
          <RetailBackofficePageHeader
            eyebrow="Sales & reports"
            title="Sales history"
            description="Loading tickets and payments…"
          />
          <RetailBackofficeSkeleton rows={8} />
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  if (!hasAccess) {
    return (
      <RetailBackofficeShell>
        <RetailBackofficeMain className="max-w-7xl">
          <RetailBackofficeAlert tone="error">
            <p className="font-medium">Access denied</p>
            <p className="mt-1 text-sm">Only owners, admins, managers, and employees can open sales history.</p>
          </RetailBackofficeAlert>
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain className="max-w-7xl">
        <RetailBackofficePageHeader
          eyebrow="Sales & reports"
          title="Sales history"
          description="Filter by date, register, cashier, and payment. Search by sale id, MoMo/card ref, customer, total, or YYYY-MM-DD. Export is this page only."
          actions={
            <div className="flex flex-wrap gap-2">
              <RetailBackofficeButton variant="secondary" type="button" onClick={exportCurrentPageCsv} disabled={!sales.length}>
                Export CSV (this page)
              </RetailBackofficeButton>
              <RetailBackofficeButton variant="secondary" type="button" onClick={() => router.push(retailPaths.reportsRegisterSessions)}>
                Register sessions
              </RetailBackofficeButton>
              <RetailBackofficeButton variant="secondary" type="button" onClick={() => router.push(retailPaths.dashboard)}>
                Dashboard
              </RetailBackofficeButton>
            </div>
          }
        />

        {error ? (
          <RetailBackofficeAlert tone="error" className="mb-4">
            {error}
          </RetailBackofficeAlert>
        ) : null}

        <RetailBackofficeCard className="mb-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <RetailBackofficeCardTitle>Filters</RetailBackofficeCardTitle>
            <button
              type="button"
              onClick={handleResetFilters}
              className="text-sm font-medium text-slate-500 transition hover:text-slate-900"
            >
              Reset all
            </button>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-5">
              <label className={retailLabelClass}>Search</label>
              <input
                type="search"
                placeholder="Sale id, ref, customer, amount, date…"
                value={saleSearch}
                onChange={(e) => {
                  setSaleSearch(e.target.value)
                  setPage(1)
                }}
                className={retailFieldClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <div className="space-y-1.5">
              <label className={retailLabelClass}>Date from</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value)
                  setPage(1)
                }}
                className={retailFieldClass}
              />
            </div>
            <div className="space-y-1.5">
              <label className={retailLabelClass}>Date to</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value)
                  setPage(1)
                }}
                className={retailFieldClass}
              />
            </div>
            <div className="space-y-1.5">
              <label className={retailLabelClass}>Payment</label>
              <RetailMenuSelect
                value={paymentMethod}
                onValueChange={(v) => {
                  setPaymentMethod(v)
                  setPage(1)
                }}
                options={SALES_HISTORY_PAYMENT_OPTIONS}
              />
            </div>
            <div className="space-y-1.5">
              <label className={retailLabelClass}>Status</label>
              <RetailMenuSelect
                value={status}
                onValueChange={(v) => {
                  setStatus(v)
                  setPage(1)
                }}
                options={SALES_HISTORY_STATUS_OPTIONS}
              />
            </div>
            <div className="space-y-1.5">
              <label className={retailLabelClass}>Cashier</label>
              <RetailMenuSelect
                value={cashierId}
                onValueChange={(v) => {
                  setCashierId(v)
                  setPage(1)
                }}
                options={cashierMenuOptions}
              />
            </div>
            <div className="space-y-1.5">
              <label className={retailLabelClass}>Register</label>
              <RetailMenuSelect
                value={registerId}
                onValueChange={(v) => {
                  setRegisterId(v)
                  setPage(1)
                }}
                options={registerMenuOptions}
              />
            </div>
          </div>
        </RetailBackofficeCard>

        <RetailBackofficeCard padding="p-0" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 backdrop-blur-sm">
                <tr>
                  <th
                    className="cursor-pointer px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition hover:bg-slate-100/80 sm:px-6"
                    onClick={() => handleSort("sale_id")}
                  >
                    <div className="flex items-center gap-2">
                      <span>Sale ID</span>
                      {getSortIcon("sale_id")}
                    </div>
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition hover:bg-slate-100/80 sm:px-6"
                    onClick={() => handleSort("date")}
                  >
                    <div className="flex items-center gap-2">
                      <span>Date / time</span>
                      {getSortIcon("date")}
                    </div>
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition hover:bg-slate-100/80 sm:px-6"
                    onClick={() => handleSort("cashier")}
                  >
                    <div className="flex items-center gap-2">
                      <span>Cashier</span>
                      {getSortIcon("cashier")}
                    </div>
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition hover:bg-slate-100/80 sm:px-6"
                    onClick={() => handleSort("register")}
                  >
                    <div className="flex items-center gap-2">
                      <span>Register</span>
                      {getSortIcon("register")}
                    </div>
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition hover:bg-slate-100/80 sm:px-6"
                    onClick={() => handleSort("amount")}
                  >
                    <div className="flex items-center gap-2">
                      <span>Amount</span>
                      {getSortIcon("amount")}
                    </div>
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition hover:bg-slate-100/80 sm:px-6"
                    onClick={() => handleSort("payment")}
                  >
                    <div className="flex items-center gap-2">
                      <span>Payment</span>
                      {getSortIcon("payment")}
                    </div>
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition hover:bg-slate-100/80 sm:px-6"
                    onClick={() => handleSort("status")}
                  >
                    <div className="flex items-center gap-2">
                      <span>Status</span>
                      {getSortIcon("status")}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {sales.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-sm text-slate-500">
                      No sales match these filters. Widen the dates or clear filters.
                    </td>
                  </tr>
                ) : (
                  sales.map((sale) => (
                    <tr key={sale.id} className="transition hover:bg-slate-50/80">
                      <td className="whitespace-nowrap px-4 py-3.5 sm:px-6">
                        <button
                          type="button"
                          title={sale.id}
                          onClick={() => router.push(retailPaths.salesHistoryDetail(sale.id))}
                          className="font-mono text-sm font-medium text-slate-900 underline-offset-2 hover:underline"
                        >
                          {sale.sale_id}
                        </button>
                        <span className="mt-0.5 block max-w-[220px] truncate font-mono text-[10px] text-slate-400" title={sale.id}>
                          {sale.id}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-sm text-slate-600 sm:px-6">{formatDate(sale.date)}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-sm sm:px-6">
                        {sale.cashier ? (
                          <span className="font-medium text-slate-900">{sale.cashier.name}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-sm text-slate-600 sm:px-6">
                        {sale.register ? sale.register.name : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-sm font-semibold tabular-nums text-slate-900 sm:px-6">
                        {formatMoney(sale.total_amount, currencyCode)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-sm text-slate-600 sm:px-6">{sale.payment_method_display}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 sm:px-6">{getStatusBadge(sale.status)}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-sm sm:px-6">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <button
                            type="button"
                            onClick={() => router.push(retailPaths.salesHistoryReceipt(sale.id))}
                            className="font-medium text-slate-900 underline-offset-2 hover:underline"
                          >
                            Receipt
                          </button>
                          <button
                            type="button"
                            onClick={() => router.push(retailPaths.salesHistoryDetail(sale.id))}
                            className="font-medium text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
                          >
                            Details
                          </button>
                          {sale.status !== "refunded" && sale.status !== "voided" && (
                            <button
                              type="button"
                              onClick={() => requestRefund(sale.id)}
                              className="font-medium text-amber-800 underline-offset-2 hover:underline"
                            >
                              Refund
                            </button>
                          )}
                          {sale.status === "refunded" && <span className="text-xs text-slate-400">Refunded</span>}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="text-sm text-slate-600">
                Page <span className="font-semibold text-slate-900">{page}</span> of {totalPages}{" "}
                <span className="text-slate-400">·</span> {totalCount} tickets
              </div>
              <div className="flex gap-2">
                <RetailBackofficeButton
                  variant="secondary"
                  type="button"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="!py-2"
                >
                  Previous
                </RetailBackofficeButton>
                <RetailBackofficeButton
                  variant="secondary"
                  type="button"
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="!py-2"
                >
                  Next
                </RetailBackofficeButton>
              </div>
            </div>
          )}
        </RetailBackofficeCard>

        {/* Render the refund override modal */}
        <RefundModalWrapper
          showOverrideModal={showRefundModal}
          saleId={refundSaleId}
          cashierId={refundCashierId}
          onClose={handleRefundClose}
          onSuccess={handleRefundSuccess}
        />
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}
