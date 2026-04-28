"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { formatMoney } from "@/lib/money"
import { MenuSelect } from "@/components/ui/MenuSelect"
import { KpiStatCard } from "@/components/ui/KpiStatCard"
import type { EstimateListRow, EstimatesListResponse } from "@/lib/estimates/estimateListApi"

type Estimate = EstimateListRow

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
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [searchInput, setSearchInput] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [listCurrencyCode, setListCurrencyCode] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState<EstimatesListResponse["pagination"]>({
    page: 1,
    pageSize: 50,
    totalCount: 0,
    totalPages: 0,
  })
  const [summary, setSummary] = useState<EstimatesListResponse["summary"]>({
    totalInFilter: 0,
    sentInScope: 0,
    acceptedInScope: 0,
  })
  const prevDebouncedSearch = useRef<string | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 300)
    return () => window.clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    if (prevDebouncedSearch.current === null) {
      prevDebouncedSearch.current = debouncedSearch
      return
    }
    if (prevDebouncedSearch.current !== debouncedSearch) {
      prevDebouncedSearch.current = debouncedSearch
      setPage(1)
    }
  }, [debouncedSearch])

  useEffect(() => {
    let cancelled = false

    const loadEstimates = async () => {
      try {
        setLoading(true)
        setError("")

        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          if (!cancelled) {
            setError("Not logged in")
            setLoading(false)
          }
          return
        }

        const business = await getCurrentBusiness(supabase, user.id)
        if (!business) {
          if (!cancelled) {
            setError("Business not found")
            setLoading(false)
          }
          return
        }

        const qs = new URLSearchParams()
        qs.set("business_id", business.id)
        qs.set("page", String(page))
        qs.set("limit", "50")
        if (statusFilter !== "all") qs.set("status", statusFilter)
        if (debouncedSearch) qs.set("search", debouncedSearch)

        const res = await fetch(`/api/estimates/list?${qs.toString()}`, {
          method: "GET",
          credentials: "same-origin",
        })

        const payload = (await res.json()) as EstimatesListResponse & { error?: string }

        if (!res.ok) {
          if (!cancelled) {
            setError(payload.error || "Failed to load quotes")
            setEstimates([])
          }
          return
        }

        if (cancelled) return

        setEstimates(payload.estimates || [])
        setPagination(payload.pagination)
        setSummary(payload.summary)
        setListCurrencyCode(payload.business_default_currency ?? null)
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Failed to load quotes"
          setError(msg)
          setEstimates([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadEstimates()
    return () => {
      cancelled = true
    }
  }, [statusFilter, debouncedSearch, page])

  const formatDate = (d: string | null) => {
    if (!d) return "—"
    return new Date(d).toLocaleDateString("en-GH", { year: "numeric", month: "short", day: "numeric" })
  }

  const convertToInvoice = (estimateId: string) => router.push(`/estimates/${estimateId}/convert`)

  const total = summary.totalInFilter
  const pending = summary.sentInScope
  const accepted = summary.acceptedInScope

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <svg className="animate-spin h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiStatCard
            icon={
              <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
            iconWrapperClassName="bg-blue-100"
            value={total}
            label="Total Quotes"
          />
          <KpiStatCard
            icon={
              <svg className="h-5 w-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            iconWrapperClassName="bg-amber-100"
            value={pending}
            label="Awaiting Response"
          />
          <KpiStatCard
            icon={
              <svg className="h-5 w-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            iconWrapperClassName="bg-emerald-100"
            value={accepted}
            label="Accepted"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search quotes or customers…"
              className="pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg bg-white w-full focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
            />
          </div>
          <MenuSelect
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v)
              setPage(1)
            }}
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
          {(searchInput || statusFilter !== "all") && (
            <button
              onClick={() => {
                setSearchInput("")
                setDebouncedSearch("")
                setStatusFilter("all")
                setPage(1)
              }}
              className="px-3 py-2.5 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg bg-white transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Table / Empty State */}
        {estimates.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
            <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <p className="text-slate-700 font-semibold mb-1">
              {debouncedSearch || statusFilter !== "all" ? "No quotes match your filters" : "No quotes yet"}
            </p>
            <p className="text-slate-500 text-sm mb-4">
              {debouncedSearch || statusFilter !== "all"
                ? "Try adjusting your search or filters."
                : "Create your first quote to get started."}
            </p>
            {!debouncedSearch && statusFilter === "all" && (
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
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Quote #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Customer
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Amount
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Expiry
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Created
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {estimates.map((estimate) => (
                    <tr
                      key={estimate.id}
                      onClick={() => router.push(`/estimates/${estimate.id}/view`)}
                      className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="text-sm font-mono font-medium text-slate-800">
                          {estimate.estimate_number || estimate.id.substring(0, 8)}
                        </span>
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
                              onClick={(e) => {
                                e.stopPropagation()
                                convertToInvoice(estimate.id)
                              }}
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
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/80">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
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
                  className="text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
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
