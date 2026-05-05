"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { useToast } from "@/components/ui/ToastProvider"
import { exportToCSV, exportToExcel, ExportColumn, formatCurrencyRaw, formatDate, formatYesNo } from "@/lib/exportUtils"
import { formatMoney } from "@/lib/money"
import { MenuSelect } from "@/components/ui/MenuSelect"
import { KpiStatCard } from "@/components/ui/KpiStatCard"

type Expense = {
  id: string
  supplier: string
  date: string
  amount: number
  nhil: number
  getfund: number
  covid: number
  vat: number
  total: number
  notes: string | null
  receipt_path: string | null
  expense_categories: {
    id: string
    name: string
  } | null
}

export default function ExpensesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const PAGE_SIZE = 25
  const toast = useToast()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [filters, setFilters] = useState({ category_id: "", start_date: "", end_date: "" })
  const [searchInput, setSearchInput] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [business, setBusiness] = useState<{ currency_code?: string } | null>(null)
  const [page, setPage] = useState(() => {
    const p = Number.parseInt(searchParams.get("page") || "1", 10)
    return Number.isFinite(p) && p > 0 ? p : 1
  })
  const [pagination, setPagination] = useState({ page: 1, pageSize: PAGE_SIZE, totalCount: 0, totalPages: 0 })
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    if (searchInput.trim()) setIsSearching(true)
    searchDebounceRef.current = setTimeout(() => {
      setPage(1)
      setSearchQuery(searchInput)
      setIsSearching(false)
    }, 300)
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current) }
  }, [searchInput])

  useEffect(() => { loadExpenses() }, [filters, searchQuery, page])

  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) return
      setBusiness(business)
      const { data: categoriesData } = await supabase
        .from("expense_categories")
        .select("*")
        .eq("business_id", business.id)
        .order("name", { ascending: true })
      setCategories(categoriesData || [])
      loadExpenses()
    } catch (err: any) {
      setError(err.message || "Failed to load data")
      setLoading(false)
    }
  }

  const loadExpenses = async () => {
    try {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) return

      let query = `/api/expenses/list?`
      if (business?.id) query += `business_id=${business.id}&`
      if (filters.category_id) query += `category_id=${filters.category_id}&`
      if (filters.start_date) query += `start_date=${filters.start_date}&`
      if (filters.end_date) query += `end_date=${filters.end_date}&`
      if (searchQuery.trim()) query += `search=${encodeURIComponent(searchQuery.trim())}&`
      query += `page=${page}&limit=${PAGE_SIZE}&`

      const response = await fetch(query)
      if (!response.ok) throw new Error("Failed to load expenses")

      const payload = await response.json()
      setExpenses(payload.expenses || [])
      setPagination(payload.pagination || { page, pageSize: PAGE_SIZE, totalCount: 0, totalPages: 0 })
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load expenses")
      setLoading(false)
    }
  }

  const totalExpenses = expenses.reduce((sum, exp) => sum + Number(exp.total || 0), 0)
  const totalTaxes = expenses.reduce((sum, exp) => sum + Number(exp.nhil || 0) + Number(exp.getfund || 0) + Number(exp.covid || 0) + Number(exp.vat || 0), 0)

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (page <= 1) params.delete("page")
    else params.set("page", String(page))
    router.replace(`/service/expenses?${params.toString()}`)
  }, [page, router, searchParams])

  // This-month total
  const now = new Date()
  const thisMonthTotal = expenses
    .filter((exp) => {
      const d = new Date(exp.date)
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    })
    .reduce((sum, exp) => sum + Number(exp.total || 0), 0)

  const filtersActive = !!(filters.category_id || filters.start_date || filters.end_date || searchInput)

  const handleExportCSV = () => {
    try {
      if (expenses.length === 0) { toast.showToast("No expenses to export", "error"); return }
      const columns: ExportColumn<Expense>[] = [
        { header: "Expense Date", accessor: (exp) => formatDate(exp.date), width: 15 },
        { header: "Category", accessor: (exp) => exp.expense_categories?.name || "Uncategorized", width: 20 },
        { header: "Description", accessor: (exp) => exp.notes || exp.supplier, width: 40 },
        { header: "Supplier", accessor: (exp) => exp.supplier, width: 25 },
        { header: "Amount", accessor: (exp) => Number(exp.amount || 0), formatter: formatCurrencyRaw, excelType: "number", width: 15 },
        { header: "VAT", accessor: (exp) => { const v = Number(exp.vat || 0); return v > 0 ? v : null }, formatter: (val) => val ? formatCurrencyRaw(val) : "", excelType: "number", width: 15 },
        { header: "Receipt Attached", accessor: (exp) => formatYesNo(!!exp.receipt_path), width: 15 },
      ]
      exportToCSV(expenses, columns, "expenses")
      toast.showToast("Expenses exported to CSV successfully", "success")
    } catch (error: any) {
      toast.showToast(error.message || "Failed to export expenses", "error")
    }
  }

  const handleExportExcel = async () => {
    try {
      if (expenses.length === 0) { toast.showToast("No expenses to export", "error"); return }
      const columns: ExportColumn<Expense>[] = [
        { header: "Expense Date", accessor: (exp) => exp.date || "", formatter: (val) => val ? formatDate(val) : "", excelType: "date", width: 15 },
        { header: "Category", accessor: (exp) => exp.expense_categories?.name || "Uncategorized", width: 20 },
        { header: "Description", accessor: (exp) => exp.notes || exp.supplier, width: 40 },
        { header: "Supplier", accessor: (exp) => exp.supplier, width: 25 },
        { header: "Amount", accessor: (exp) => Number(exp.amount || 0), formatter: formatCurrencyRaw, excelType: "number", width: 15 },
        { header: "VAT", accessor: (exp) => { const v = Number(exp.vat || 0); return v > 0 ? v : null }, formatter: (val) => val ? formatCurrencyRaw(val) : "", excelType: "number", width: 15 },
        { header: "Receipt Attached", accessor: (exp) => formatYesNo(!!exp.receipt_path), width: 15 },
      ]
      await exportToExcel(expenses, columns, "expenses")
      toast.showToast("Expenses exported to Excel successfully", "success")
    } catch (error: any) {
      toast.showToast(error.message || "Failed to export expenses", "error")
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <svg className="animate-spin h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div data-tour="service-expenses-overview">
            <h1 className="text-2xl font-bold text-slate-900">Expenses</h1>
            <p className="text-sm text-slate-500 mt-0.5">Track and manage your business expenses</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => router.push("/service/expenses/categories")}
              className="inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              Categories
            </button>
            {expenses.length > 0 && (
              <>
                <button
                  onClick={handleExportCSV}
                  className="inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  CSV
                </button>
                <button
                  onClick={handleExportExcel}
                  className="inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Excel
                </button>
              </>
            )}
            <button
              data-tour="service-expenses-new"
              onClick={() => router.push("/service/expenses/create")}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Expense
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
        )}

        {/* Stat Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiStatCard
            icon={
              <svg className="h-5 w-5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            }
            iconWrapperClassName="bg-rose-100"
            value={formatMoney(totalExpenses, business?.currency_code || "GHS")}
            label="Total Spent"
            valueVariant="currency"
          />
          <KpiStatCard
            icon={
              <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            }
            iconWrapperClassName="bg-blue-100"
            value={formatMoney(thisMonthTotal, business?.currency_code || "GHS")}
            label="This Month"
            valueVariant="currency"
          />
          <KpiStatCard
            icon={
              <svg className="h-5 w-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            }
            iconWrapperClassName="bg-slate-100"
            value={expenses.length}
            label="Total Records"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3" data-tour="service-expenses-filters">
          <div className="relative flex-1 min-w-[200px]">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              {isSearching ? (
                <svg className="animate-spin w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              )}
            </div>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by supplier…"
              className="pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg bg-white w-full focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
            />
          </div>
          <MenuSelect
            value={filters.category_id}
            onValueChange={(v) => {
              setPage(1)
              setFilters({ ...filters, category_id: v })
            }}
            wrapperClassName="w-auto shrink-0 min-w-[11rem]"
            options={[
              { value: "", label: "All Categories" },
              ...categories.map((cat) => ({ value: cat.id, label: cat.name })),
            ]}
          />
          <input
            type="date"
            value={filters.start_date}
            onChange={(e) => {
              setPage(1)
              setFilters({ ...filters, start_date: e.target.value })
            }}
            className="px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 text-slate-700"
          />
          <input
            type="date"
            value={filters.end_date}
            onChange={(e) => {
              setPage(1)
              setFilters({ ...filters, end_date: e.target.value })
            }}
            className="px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 text-slate-700"
          />
          {filtersActive && (
            <button
              onClick={() => { setPage(1); setFilters({ category_id: "", start_date: "", end_date: "" }); setSearchInput(""); setSearchQuery("") }}
              className="px-3 py-2.5 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg bg-white transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Table / Empty State */}
        {expenses.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center" data-tour="service-expenses-list">
            <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <p className="text-slate-700 font-semibold mb-1">
              {filtersActive ? "No expenses match your filters" : "No expenses yet"}
            </p>
            <p className="text-slate-500 text-sm mb-4">
              {filtersActive ? "Try adjusting your search or filters." : "Start tracking your business expenses."}
            </p>
            {!filtersActive && (
              <button
                onClick={() => router.push("/service/expenses/create")}
                className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-colors"
              >
                Add Expense
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden" data-tour="service-expenses-list">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Supplier</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Category</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Taxes</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Total</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => {
                    const taxes = Number(expense.nhil || 0) + Number(expense.getfund || 0) + Number(expense.covid || 0) + Number(expense.vat || 0)
                    return (
                      <tr
                        key={expense.id}
                        onClick={() => router.push(`/service/expenses/${expense.id}/view`)}
                        className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className="text-sm text-slate-500">
                            {new Date(expense.date).toLocaleDateString("en-GH", { year: "numeric", month: "short", day: "numeric" })}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className="text-sm font-medium text-slate-800">{expense.supplier}</span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className="text-sm text-slate-500">{expense.expense_categories?.name || "Uncategorized"}</span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-right">
                          <span className="text-sm text-slate-700 tabular-nums">{formatMoney(Number(expense.amount), business?.currency_code || "GHS")}</span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-right">
                          <span className="text-sm text-slate-500 tabular-nums">{formatMoney(taxes, business?.currency_code || "GHS")}</span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-right">
                          <span className="text-sm font-semibold text-slate-900 tabular-nums">{formatMoney(Number(expense.total), business?.currency_code || "GHS")}</span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-right">
                          <button
                            onClick={(e) => { e.stopPropagation(); router.push(`/service/expenses/${expense.id}/edit`) }}
                            className="text-xs px-2.5 py-1 bg-slate-50 text-slate-600 border border-slate-200 rounded-lg font-medium hover:bg-slate-100 transition-colors mr-2"
                          >
                            Edit
                          </button>
                          <span className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">View →</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/80">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-xs text-slate-600 tabular-nums">
                  Page {pagination.page} of {pagination.totalPages} ({pagination.totalCount} total)
                </span>
                <button
                  type="button"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
