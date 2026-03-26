"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { usePathname } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
type CreditNote = {
  id: string
  credit_number: string
  date: string
  total: number
  status: string
  reason: string | null
  invoices: {
    invoice_number: string
    customers: {
      name: string
    } | null
  } | null
}

const STATUS_DOT: Record<string, string> = {
  draft: "bg-slate-400",
  issued: "bg-blue-500",
  applied: "bg-emerald-500",
  cancelled: "bg-red-500",
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  issued: "Issued",
  applied: "Applied",
  cancelled: "Cancelled",
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[status] ?? "bg-slate-400"}`} />
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

export default function CreditNotesPage() {
  const router = useRouter()
  const pathname = usePathname()
  const [loading, setLoading] = useState(true)
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([])
  const [error, setError] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [search, setSearch] = useState("")
  const isServiceRoute = pathname?.startsWith("/service/")
  const createPath = isServiceRoute ? "/service/credit-notes/create" : "/credit-notes/create"
  const viewPath = (creditNoteId: string) =>
    isServiceRoute ? `/service/credit-notes/${creditNoteId}/view` : `/credit-notes/${creditNoteId}/view`

  useEffect(() => {
    loadCreditNotes()
  }, [statusFilter])

  const loadCreditNotes = async () => {
    try {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) { setLoading(false); return }

      const params = new URLSearchParams()
      params.append("business_id", business.id)
      if (statusFilter !== "all") params.append("status", statusFilter)

      const response = await fetch(`/api/credit-notes/list?${params.toString()}`)
      if (!response.ok) throw new Error("Failed to load credit notes")

      const { creditNotes: data } = await response.json()
      setCreditNotes(data || [])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load credit notes")
      setLoading(false)
    }
  }

  // Derived stats
  const total = creditNotes.length
  const applied = creditNotes.filter((cn) => cn.status === "applied").length
  const pending = creditNotes.filter((cn) => cn.status === "issued").length
  const totalValue = creditNotes.reduce((sum, cn) => sum + Number(cn.total || 0), 0)

  // Client-side search
  const visible = search.trim()
    ? creditNotes.filter(
        (cn) =>
          cn.credit_number.toLowerCase().includes(search.toLowerCase()) ||
          (cn.invoices?.customers?.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
          (cn.invoices?.invoice_number ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : creditNotes

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
              <h1 className="text-2xl font-bold text-slate-900">Credit Notes</h1>
              <p className="text-sm text-slate-500 mt-0.5">Manage invoice adjustments and refunds</p>
            </div>
            <button
              onClick={() => router.push(createPath)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Credit Note
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
          )}

          {/* Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l-4-4 4-4m6 8l4-4-4-4" />
                  </svg>
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{total}</p>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Total Credits</p>
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
                  <p className="text-2xl font-bold text-slate-900">{applied}</p>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Applied</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{pending}</p>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Pending</p>
                </div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search credit notes or customers…"
                className="pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg bg-white w-full focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 text-slate-700"
            >
              <option value="all">All Status</option>
              <option value="draft">Draft</option>
              <option value="issued">Issued</option>
              <option value="applied">Applied</option>
              <option value="cancelled">Cancelled</option>
            </select>
            {(search || statusFilter !== "all") && (
              <button
                onClick={() => { setSearch(""); setStatusFilter("all") }}
                className="px-3 py-2.5 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg bg-white transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {/* Table / Empty State */}
          {visible.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
              <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-slate-700 font-semibold mb-1">
                {search || statusFilter !== "all" ? "No credit notes match your filters" : "No credit notes yet"}
              </p>
              <p className="text-slate-500 text-sm mb-4">
                {search || statusFilter !== "all"
                  ? "Try adjusting your search or filters."
                  : "Create a credit note to adjust or refund an invoice."}
              </p>
              {!search && statusFilter === "all" && (
                <button
                  onClick={() => router.push(createPath)}
                  className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-colors"
                >
                  Create Credit Note
                </button>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Credit Note #</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Invoice</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Customer</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((cn) => (
                      <tr
                        key={cn.id}
                        onClick={() => router.push(viewPath(cn.id))}
                        className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className="text-sm font-mono font-medium text-slate-800">{cn.credit_number}</span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className="text-sm text-slate-600">{cn.invoices?.invoice_number || "—"}</span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className="text-sm text-slate-700">{cn.invoices?.customers?.name || "—"}</span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className="text-sm text-slate-500">
                            {new Date(cn.date).toLocaleDateString("en-GH", { year: "numeric", month: "short", day: "numeric" })}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-right">
                          <span className="text-sm font-semibold text-rose-600 tabular-nums">
                            -{Number(cn.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <StatusBadge status={cn.status} />
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-right">
                          <span className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">View →</span>
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
