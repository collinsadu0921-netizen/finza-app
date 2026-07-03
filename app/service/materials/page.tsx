"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { replaceIfChanged } from "@/lib/navigation/safeReplace"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { MenuSelect } from "@/components/ui/MenuSelect"
import { KpiStatCard } from "@/components/ui/KpiStatCard"
import { stockStatusLabel } from "@/lib/service/materialMovementLabels"

type MaterialRow = {
  id: string
  name: string
  unit: string
  quantity_on_hand: number
  cost_price: number
  selling_price: number | null
  reorder_level: number
  is_active: boolean
}

type MaterialsSummary = {
  totalItems: number
  activeItems: number
  lowStockItems: number
}

export default function ServiceMaterialsPage() {
  const router = useRouter()
  const pathname = usePathname() ?? "/service/materials"
  const searchParams = useSearchParams()
  const searchParamsString = searchParams.toString()
  const { format } = useBusinessCurrency()
  const PAGE_SIZE = 25
  const [rows, setRows] = useState<MaterialRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [search, setSearch] = useState(searchParams.get("search") || "")
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "")
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">(
    (searchParams.get("status") as "all" | "active" | "inactive") || "all"
  )
  const [filterStock, setFilterStock] = useState<"all" | "low" | "ok">(
    (searchParams.get("stock") as "all" | "low" | "ok") || "all"
  )
  const [page, setPage] = useState(() => {
    const p = Number.parseInt(searchParams.get("page") || "1", 10)
    return Number.isFinite(p) && p > 0 ? p : 1
  })
  const [pagination, setPagination] = useState({ page: 1, pageSize: PAGE_SIZE, totalCount: 0, totalPages: 0 })
  const [summary, setSummary] = useState<MaterialsSummary>({ totalItems: 0, activeItems: 0, lowStockItems: 0 })
  const searchDebounce = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => { load() }, [searchQuery, filterStatus, filterStock, page])

  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(() => { setPage(1); setSearchQuery(search.trim()) }, 280)
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current) }
  }, [search])

  const load = async () => {
    try {
      setLoading(true)
      setError("")
      const params = new URLSearchParams()
      if (searchQuery) params.set("search", searchQuery)
      if (filterStatus !== "all") params.set("status", filterStatus)
      if (filterStock !== "all") params.set("stock", filterStock)
      params.set("page", String(page))
      params.set("limit", String(PAGE_SIZE))
      const res = await fetch(`/api/service/materials/workspace?${params.toString()}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Failed to load materials")
        setLoading(false)
        return
      }
      setRows((data.rows ?? []) as MaterialRow[])
      setPagination(data.pagination || { page, pageSize: PAGE_SIZE, totalCount: 0, totalPages: 0 })
      setSummary({
        totalItems: data.summary?.totalItems ?? 0,
        activeItems: data.summary?.activeItems ?? 0,
        lowStockItems: data.summary?.lowStockItems ?? 0,
      })
      setLoading(false)
    } catch {
      setError("Failed to load")
      setLoading(false)
    }
  }

  const filtersActive = !!(search || filterStatus !== "all" || filterStock !== "all")

  useEffect(() => {
    const params = new URLSearchParams(searchParamsString)
    if (searchQuery) params.set("search", searchQuery)
    else params.delete("search")
    if (filterStatus !== "all") params.set("status", filterStatus)
    else params.delete("status")
    if (filterStock !== "all") params.set("stock", filterStock)
    else params.delete("stock")
    if (page > 1) params.set("page", String(page))
    else params.delete("page")
    replaceIfChanged(router, pathname, searchParamsString, `/service/materials?${params.toString()}`)
  }, [searchQuery, filterStatus, filterStock, page, pathname, searchParamsString, router])

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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Materials</h1>
            <p className="text-sm text-slate-500 mt-0.5">Save materials, prices, and quantities your business uses.</p>
          </div>
          <button onClick={() => router.push("/service/materials/new")}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700">
            Add Material
          </button>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <KpiStatCard icon={<span className="text-blue-600 font-bold">#</span>} iconWrapperClassName="bg-blue-100" label="Materials" value={String(summary.totalItems)} />
          <KpiStatCard icon={<span className="text-emerald-600 font-bold">✓</span>} iconWrapperClassName="bg-emerald-100" label="Active" value={String(summary.activeItems)} />
          <KpiStatCard icon={<span className="text-amber-600 font-bold">!</span>} iconWrapperClassName="bg-amber-100" label="Low stock" value={String(summary.lowStockItems)} />
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input type="search" placeholder="Search materials…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="flex-1 border border-slate-200 rounded-lg px-4 py-2 text-sm" />
          <MenuSelect value={filterStatus} onValueChange={(v) => { setPage(1); setFilterStatus(v as typeof filterStatus) }}
            options={[{ value: "all", label: "All status" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} />
          <MenuSelect value={filterStock} onValueChange={(v) => { setPage(1); setFilterStock(v as typeof filterStock) }}
            options={[{ value: "all", label: "All stock" }, { value: "low", label: "Low stock" }, { value: "ok", label: "In stock" }]} />
        </div>

        {rows.length === 0 ? (
          <div className="bg-white rounded-xl border p-12 text-center">
            <p className="font-semibold text-slate-700 mb-1">{filtersActive ? "No materials match your filters" : "No materials yet"}</p>
            {!filtersActive && (
              <button onClick={() => router.push("/service/materials/new")} className="mt-4 px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg">Add Material</button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b text-left text-xs font-semibold text-slate-500 uppercase">
                    <th className="px-4 py-3">Material</th>
                    <th className="px-4 py-3">Unit</th>
                    <th className="px-4 py-3 text-right">Cost price</th>
                    <th className="px-4 py-3 text-right">Selling price</th>
                    <th className="px-4 py-3 text-right">Quantity</th>
                    <th className="px-4 py-3">Stock status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const status = stockStatusLabel({
                      quantity_on_hand: row.quantity_on_hand,
                      reorder_level: row.reorder_level,
                      is_active: row.is_active,
                    })
                    const statusClass =
                      status.tone === "low" ? "text-amber-700 bg-amber-50" :
                      status.tone === "out" ? "text-red-700 bg-red-50" :
                      status.tone === "inactive" ? "text-slate-500 bg-slate-100" :
                      "text-emerald-700 bg-emerald-50"
                    return (
                      <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3.5 font-medium text-slate-900">{row.name}</td>
                        <td className="px-4 py-3.5 text-slate-600">{row.unit}</td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-slate-600">
                          {row.cost_price > 0 ? format(row.cost_price) : "—"}
                        </td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-slate-700">
                          {row.selling_price != null ? format(row.selling_price) : "—"}
                        </td>
                        <td className="px-4 py-3.5 text-right tabular-nums font-medium">{Number(row.quantity_on_hand)}</td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${statusClass}`}>{status.label}</span>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <button onClick={() => router.push(`/service/materials/${row.id}/add-stock`)} className="text-xs px-2 py-1 border rounded-lg hover:bg-slate-50">Add stock</button>
                            <button onClick={() => router.push(`/service/materials/${row.id}/use-stock`)} className="text-xs px-2 py-1 border rounded-lg hover:bg-slate-50">Use stock</button>
                            <button onClick={() => router.push(`/service/materials/${row.id}/history`)} className="text-xs px-2 py-1 border rounded-lg hover:bg-slate-50">History</button>
                            <button onClick={() => router.push(`/service/materials/${row.id}/edit`)} className="text-xs px-2 py-1 text-slate-600 hover:text-slate-900">Edit</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t bg-slate-50/80">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="text-sm px-3 py-1.5 border rounded-lg disabled:opacity-40">Previous</button>
                <span className="text-xs text-slate-600">Page {pagination.page} of {pagination.totalPages}</span>
                <button type="button" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}
                  className="text-sm px-3 py-1.5 border rounded-lg disabled:opacity-40">Next</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
