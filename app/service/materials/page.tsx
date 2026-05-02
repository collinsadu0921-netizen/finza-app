"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { MenuSelect } from "@/components/ui/MenuSelect"
import { KpiStatCard } from "@/components/ui/KpiStatCard"

type MaterialRow = {
  id: string
  name: string
  sku: string | null
  unit: string
  quantity_on_hand: number
  average_cost: number
  reorder_level: number
  is_active: boolean
  last_movement_at: string | null
  last_movement_type: string | null
  last_movement_reference_id: string | null
}

export default function ServiceMaterialsPage() {
  const router = useRouter()
  const { format } = useBusinessCurrency()
  const [rows, setRows] = useState<MaterialRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all")
  const [filterStock, setFilterStock] = useState<"all" | "low" | "ok">("all")
  const searchDebounce = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(() => setSearchQuery(search), 280)
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current) }
  }, [search])

  const load = async () => {
    try {
      setError("")
      const res = await fetch("/api/service/materials/workspace")
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Failed to load materials")
        setLoading(false)
        return
      }
      setRows((data.rows ?? []) as MaterialRow[])
      setLoading(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load")
      setLoading(false)
    }
  }

  // Derived stats
  const totalItems = rows.length
  const activeItems = rows.filter((r) => r.is_active).length
  const lowStockItems = rows.filter(
    (r) => r.is_active && Number(r.reorder_level) > 0 && Number(r.quantity_on_hand) <= Number(r.reorder_level)
  ).length
  const totalValue = rows.reduce(
    (sum, r) => sum + Number(r.quantity_on_hand) * Number(r.average_cost),
    0
  )

  // Client-side filtering
  const visible = rows.filter((r) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      if (
        !r.name.toLowerCase().includes(q) &&
        !(r.sku ?? "").toLowerCase().includes(q)
      )
        return false
    }
    if (filterStatus === "active" && !r.is_active) return false
    if (filterStatus === "inactive" && r.is_active) return false
    if (filterStock === "low") {
      const isLow =
        r.is_active &&
        Number(r.reorder_level) > 0 &&
        Number(r.quantity_on_hand) <= Number(r.reorder_level)
      if (!isLow) return false
    }
    if (filterStock === "ok") {
      const isLow =
        r.is_active &&
        Number(r.reorder_level) > 0 &&
        Number(r.quantity_on_hand) <= Number(r.reorder_level)
      if (isLow) return false
    }
    return true
  })

  const filtersActive = !!(search || filterStatus !== "all" || filterStock !== "all")

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
            <h1 className="text-2xl font-bold text-slate-900">Materials</h1>
            <p className="text-sm text-slate-500 mt-0.5">Track service materials and stock levels</p>
          </div>
          <button
            onClick={() => router.push("/service/materials/new")}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Material
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
        )}

        {/* Stat Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiStatCard
            icon={
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            }
            iconWrapperClassName="bg-blue-100"
            value={totalItems}
            label="Total"
          />
          <KpiStatCard
            icon={
              <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            iconWrapperClassName="bg-emerald-100"
            value={activeItems}
            label="Active"
          />
          <KpiStatCard
            icon={
              <svg className={`w-5 h-5 ${lowStockItems > 0 ? "text-amber-600" : "text-slate-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            }
            iconWrapperClassName={lowStockItems > 0 ? "bg-amber-100" : "bg-slate-100"}
            value={lowStockItems}
            label="Low Stock"
            valueClassName={lowStockItems > 0 ? "text-amber-600" : undefined}
            className={
              lowStockItems > 0 ? "border-amber-300 hover:bg-amber-50" : undefined
            }
            onClick={() => lowStockItems > 0 && setFilterStock(filterStock === "low" ? "all" : "low")}
          />
          <KpiStatCard
            icon={
              <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            iconWrapperClassName="bg-slate-100"
            value={format(totalValue)}
            label="Total Value"
            valueVariant="currency"
          />
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
              placeholder="Search by name or SKU…"
              className="pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg bg-white w-full focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
            />
          </div>
          <MenuSelect
            value={filterStatus}
            onValueChange={(v) => setFilterStatus(v as "all" | "active" | "inactive")}
            wrapperClassName="w-auto shrink-0 min-w-[9rem]"
            options={[
              { value: "all", label: "All Status" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
          />
          <MenuSelect
            value={filterStock}
            onValueChange={(v) => setFilterStock(v as "all" | "low" | "ok")}
            wrapperClassName="w-auto shrink-0 min-w-[9rem]"
            options={[
              { value: "all", label: "All Stock" },
              { value: "low", label: "Low Stock" },
              { value: "ok", label: "In Stock" },
            ]}
          />
          {filtersActive && (
            <button
              onClick={() => { setSearch(""); setSearchQuery(""); setFilterStatus("all"); setFilterStock("all") }}
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <p className="text-slate-700 font-semibold mb-1">
              {filtersActive ? "No materials match your filters" : "No materials yet"}
            </p>
            <p className="text-slate-500 text-sm mb-4">
              {filtersActive
                ? "Try adjusting your search or filters."
                : "Add your first material to start tracking service stock."}
            </p>
            {!filtersActive && (
              <button
                onClick={() => router.push("/service/materials/new")}
                className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-colors"
              >
                Add Material
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">SKU</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Unit</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">On Hand</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Avg Cost</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Value</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Reorder At</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Last Movement</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const isLow =
                      row.is_active &&
                      Number(row.reorder_level) > 0 &&
                      Number(row.quantity_on_hand) <= Number(row.reorder_level)
                    const lineValue = Number(row.quantity_on_hand) * Number(row.average_cost)
                    return (
                      <tr
                        key={row.id}
                        className={`border-b border-slate-100 transition-colors ${isLow ? "bg-amber-50/60 hover:bg-amber-50" : "hover:bg-slate-50"}`}
                      >
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-900">{row.name}</span>
                            {isLow && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                Low
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className="text-sm text-slate-500 font-mono">{row.sku ?? "—"}</span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className="text-sm text-slate-600">{row.unit}</span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-right">
                          <span className={`text-sm font-semibold tabular-nums ${isLow ? "text-amber-600" : "text-slate-900"}`}>
                            {Number(row.quantity_on_hand ?? 0)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-right">
                          <span className="text-sm text-slate-600 tabular-nums">{format(Number(row.average_cost ?? 0))}</span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-right">
                          <span className="text-sm font-medium text-slate-800 tabular-nums">{format(lineValue)}</span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-right">
                          <span className="text-sm text-slate-500 tabular-nums">
                            {Number(row.reorder_level) > 0 ? Number(row.reorder_level) : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${row.is_active ? "text-emerald-700" : "text-slate-500"}`}>
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${row.is_active ? "bg-emerald-500" : "bg-slate-400"}`} />
                            {row.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          {row.last_movement_at ? (
                            <div>
                              <p className="text-xs text-slate-700 font-medium capitalize">
                                {(row.last_movement_type ?? "").replace(/_/g, " ")}
                              </p>
                              <p className="text-xs text-slate-400">
                                {new Date(row.last_movement_at).toLocaleDateString("en-GH", { day: "2-digit", month: "short", year: "numeric" })}
                              </p>
                              {row.last_movement_reference_id && row.last_movement_type === "job_usage" && (
                                <a
                                  href={`/service/jobs/${row.last_movement_reference_id}`}
                                  className="text-xs text-blue-600 hover:underline font-mono"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {row.last_movement_reference_id.slice(0, 8)}…
                                </a>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-right">
                          <div className="flex items-center justify-end gap-3">
                            <button
                              onClick={() => router.push(`/service/materials/${row.id}/adjust`)}
                              className="text-xs px-2.5 py-1 bg-slate-50 text-slate-600 border border-slate-200 rounded-lg font-medium hover:bg-slate-100 transition-colors"
                            >
                              Adjust Stock
                            </button>
                            <button
                              onClick={() => router.push(`/service/materials/${row.id}/edit`)}
                              className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors"
                            >
                              Edit →
                            </button>
                          </div>
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
