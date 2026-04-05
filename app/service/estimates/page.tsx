"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { formatMoney } from "@/lib/money"
import { MenuSelect } from "@/components/ui/MenuSelect"

type Estimate = {
  id: string
  estimate_number: string
  customer_id: string | null
  customer_name: string | null
  total_amount: number
  status: "draft" | "sent" | "accepted" | "rejected" | "expired"
  expiry_date: string | null
  created_at: string
}

const STATUS_DOT: Record<string, string> = {
  draft: "bg-slate-400",
  sent: "bg-amber-500",
  accepted: "bg-emerald-500",
  rejected: "bg-red-500",
  expired: "bg-red-400",
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[status] ?? "bg-slate-400"}`} />
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

export default function EstimatesPage() {
  const router = useRouter()
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [listCurrencyCode, setListCurrencyCode] = useState<string | null>(null)

  useEffect(() => {
    loadEstimates()
  }, [])

  useEffect(() => {
    if (businessId) loadEstimates()
  }, [businessId, statusFilter])

  const loadEstimates = async () => {
    try {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError("Not logged in"); setLoading(false); return }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) { setError("Business not found"); setLoading(false); return }

      setBusinessId(business.id)
      setListCurrencyCode(business.default_currency || null)

      let query = supabase
        .from("estimates")
        .select("*")
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })

      if (statusFilter !== "all") query = query.eq("status", statusFilter)

      const { data, error: fetchError } = await query

      if (fetchError) {
        if (fetchError.code === "42P01") { setEstimates([]); setLoading(false); return }
        throw fetchError
      }

      const rows = data || []
      const customerIds = [...new Set(rows.map((est: any) => est.customer_id).filter(Boolean))] as string[]
      const customerMap: Record<string, string> = {}
      if (customerIds.length > 0) {
        const { data: customers } = await supabase.from("customers").select("id, name").in("id", customerIds)
        for (const c of customers || []) customerMap[c.id] = c.name ?? "No Customer"
      }

      setEstimates(rows.map((est: any) => ({
        id: est.id,
        estimate_number: est.estimate_number || est.id.substring(0, 8),
        customer_id: est.customer_id,
        customer_name: est.customer_id ? (customerMap[est.customer_id] ?? "No Customer") : "No Customer",
        total_amount: Number(est.total_amount || 0),
        status: est.status || "draft",
        expiry_date: est.expiry_date,
        created_at: est.created_at,
      })))
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load quotes")
      setLoading(false)
    }
  }

  const formatDate = (d: string | null) => {
    if (!d) return "—"
    return new Date(d).toLocaleDateString("en-GH", { year: "numeric", month: "short", day: "numeric" })
  }

  const convertToInvoice = (estimateId: string) => router.push(`/estimates/${estimateId}/convert`)

  // Derived stats (from loaded set, not filtered by search)
  const total = estimates.length
  const pending = estimates.filter((e) => e.status === "sent").length
  const accepted = estimates.filter((e) => e.status === "accepted").length

  // Client-side search filter
  const visible = search.trim()
    ? estimates.filter(
        (e) =>
          e.estimate_number.toLowerCase().includes(search.toLowerCase()) ||
          (e.customer_name ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : estimates

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
            <h1 className="text-2xl font-bold text-slate-900">Quotes</h1>
            <p className="text-sm text-slate-500 mt-0.5">Manage and track your quotes</p>
          </div>
          <button
            onClick={() => router.push("/estimates/new")}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Quote
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
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{total}</p>
                <p className="text-xs text-slate-500 uppercase tracking-wide">Total Quotes</p>
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
                <p className="text-xs text-slate-500 uppercase tracking-wide">Awaiting Response</p>
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
                <p className="text-2xl font-bold text-slate-900">{accepted}</p>
                <p className="text-xs text-slate-500 uppercase tracking-wide">Accepted</p>
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
              placeholder="Search quotes or customers…"
              className="pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg bg-white w-full focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
            />
          </div>
          <MenuSelect
            value={statusFilter}
            onValueChange={setStatusFilter}
            wrapperClassName="w-auto shrink-0 min-w-[10.5rem]"
            options={[
              { value: "all", label: "All Status" },
              { value: "draft", label: "Draft" },
              { value: "sent", label: "Sent" },
              { value: "accepted", label: "Accepted" },
              { value: "rejected", label: "Rejected" },
              { value: "expired", label: "Expired" },
            ]}
          />
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
              {search || statusFilter !== "all" ? "No quotes match your filters" : "No quotes yet"}
            </p>
            <p className="text-slate-500 text-sm mb-4">
              {search || statusFilter !== "all" ? "Try adjusting your search or filters." : "Create your first quote to get started."}
            </p>
            {!search && statusFilter === "all" && (
              <button
                onClick={() => router.push("/estimates/new")}
                className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-colors"
              >
                Create Quote
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Quote #</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Customer</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Expiry</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Created</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((estimate) => (
                    <tr
                      key={estimate.id}
                      onClick={() => router.push(`/estimates/${estimate.id}/view`)}
                      className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="text-sm font-mono font-medium text-slate-800">{estimate.estimate_number}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="text-sm text-slate-700">{estimate.customer_name}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <span className="text-sm font-semibold text-slate-900 tabular-nums">
                          {formatMoney(estimate.total_amount, listCurrencyCode)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <StatusBadge status={estimate.status} />
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="text-sm text-slate-500">{formatDate(estimate.expiry_date)}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="text-sm text-slate-500">{formatDate(estimate.created_at)}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-2">
                          {estimate.status === "accepted" && (
                            <button
                              onClick={(e) => { e.stopPropagation(); convertToInvoice(estimate.id) }}
                              className="text-xs px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg font-medium hover:bg-emerald-100 transition-colors"
                            >
                              Convert
                            </button>
                          )}
                          <span className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">
                            View →
                          </span>
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
