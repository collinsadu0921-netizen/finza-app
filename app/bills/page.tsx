"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/ToastProvider"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"

type Bill = {
  id: string
  supplier_name: string
  bill_number: string
  issue_date: string
  due_date: string | null
  status: string
  total: number
  total_paid: number
  balance: number
  bill_type?: "standard" | "import"
}

const STATUS_DOT: Record<string, string> = {
  draft: "bg-slate-400",
  open: "bg-blue-500",
  partially_paid: "bg-amber-500",
  paid: "bg-emerald-500",
  overdue: "bg-red-500",
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  open: "Open",
  partially_paid: "Partial",
  paid: "Paid",
  overdue: "Overdue",
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[status] ?? "bg-slate-400"}`} />
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

export default function BillsPage() {
  const router = useRouter()
  const toast = useToast()
  const { format } = useBusinessCurrency()
  const [loading, setLoading] = useState(true)
  const [bills, setBills] = useState<Bill[]>([])
  const [error, setError] = useState("")
  const [filters, setFilters] = useState({ supplier_name: "", status: "all", start_date: "", end_date: "" })
  const [searchInput, setSearchInput] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    if (searchInput.trim()) setIsSearching(true)
    searchDebounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput)
      setIsSearching(false)
    }, 300)
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current) }
  }, [searchInput])

  useEffect(() => { loadBills() }, [filters, searchQuery])

  const loadBills = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (filters.supplier_name) params.append("supplier_name", filters.supplier_name)
      if (filters.status !== "all") params.append("status", filters.status)
      if (filters.start_date) params.append("start_date", filters.start_date)
      if (filters.end_date) params.append("end_date", filters.end_date)
      if (searchQuery) params.append("search", searchQuery)

      const response = await fetch(`/api/bills/list?${params.toString()}`)
      if (!response.ok) throw new Error("Failed to load bills")

      const { bills: data } = await response.json()
      setBills(data || [])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load bills")
      setLoading(false)
    }
  }

  const totalOutstanding = bills
    .filter((b) => b.status !== "paid" && b.status !== "draft")
    .reduce((sum, b) => sum + b.balance, 0)

  const totalPaid = bills
    .filter((b) => b.status === "paid")
    .reduce((sum, b) => sum + Number(b.total), 0)

  const filtersActive = !!(filters.supplier_name || filters.status !== "all" || filters.start_date || filters.end_date || searchInput)

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
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Supplier Bills</h1>
              <p className="text-sm text-slate-500 mt-0.5">Manage accounts payable and supplier invoices</p>
            </div>
            <button
              onClick={() => router.push("/bills/create")}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Bill
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
          )}

          {/* Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xl font-bold text-slate-900">{format(totalOutstanding)}</p>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Outstanding</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xl font-bold text-slate-900">{format(totalPaid)}</p>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Total Paid</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{bills.length}</p>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Total Bills</p>
                </div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
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
                placeholder="Search bills or suppliers…"
                className="pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg bg-white w-full focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
              />
            </div>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 text-slate-700"
            >
              <option value="all">All Status</option>
              <option value="draft">Draft</option>
              <option value="open">Open</option>
              <option value="partially_paid">Partially Paid</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
            </select>
            <input
              type="date"
              value={filters.start_date}
              onChange={(e) => setFilters({ ...filters, start_date: e.target.value })}
              className="px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 text-slate-700"
            />
            <input
              type="date"
              value={filters.end_date}
              onChange={(e) => setFilters({ ...filters, end_date: e.target.value })}
              className="px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 text-slate-700"
            />
            {filtersActive && (
              <button
                onClick={() => {
                  setFilters({ supplier_name: "", status: "all", start_date: "", end_date: "" })
                  setSearchInput("")
                  setSearchQuery("")
                }}
                className="px-3 py-2.5 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg bg-white transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {/* Table / Empty State */}
          {bills.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
              <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-slate-700 font-semibold mb-1">
                {filtersActive ? "No bills match your filters" : "No supplier bills yet"}
              </p>
              <p className="text-slate-500 text-sm mb-4">
                {filtersActive ? "Try adjusting your search or filters." : "Create your first supplier bill to track accounts payable."}
              </p>
              {!filtersActive && (
                <button
                  onClick={() => router.push("/bills/create")}
                  className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-colors"
                >
                  Add Bill
                </button>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Bill #</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Supplier</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Issue Date</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Due Date</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Total</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider" title="Amount still owed to the supplier">Balance</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map((bill) => (
                      <tr
                        key={bill.id}
                        onClick={() => router.push(`/bills/${bill.id}/view`)}
                        className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono font-medium text-slate-800">{bill.bill_number}</span>
                            {bill.bill_type === "import" && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                                Import
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className="text-sm text-slate-700">{bill.supplier_name}</span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className="text-sm text-slate-500">
                            {new Date(bill.issue_date).toLocaleDateString("en-GH", { year: "numeric", month: "short", day: "numeric" })}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className="text-sm text-slate-500">
                            {bill.due_date
                              ? new Date(bill.due_date).toLocaleDateString("en-GH", { year: "numeric", month: "short", day: "numeric" })
                              : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-right">
                          <span className="text-sm font-semibold text-slate-900 tabular-nums">{format(Number(bill.total))}</span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-right">
                          <span className={`text-sm font-semibold tabular-nums ${bill.balance > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                            {format(bill.balance)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <StatusBadge status={bill.status} />
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-right">
                          <div className="flex items-center justify-end gap-3">
                            {bill.status === "draft" && (
                              <button
                                onClick={(e) => { e.stopPropagation(); router.push(`/bills/${bill.id}/edit`) }}
                                className="text-xs px-2.5 py-1 bg-slate-50 text-slate-600 border border-slate-200 rounded-lg font-medium hover:bg-slate-100 transition-colors"
                              >
                                Edit
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); router.push(`/suppliers/${encodeURIComponent(bill.supplier_name)}/statement`) }}
                              className="text-xs px-2.5 py-1 bg-slate-50 text-slate-600 border border-slate-200 rounded-lg font-medium hover:bg-slate-100 transition-colors"
                              title="View Supplier Statement"
                            >
                              Statement
                            </button>
                            <span className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">View →</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
  )
}
