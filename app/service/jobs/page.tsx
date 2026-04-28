"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { MenuSelect } from "@/components/ui/MenuSelect"
import { KpiStatCard } from "@/components/ui/KpiStatCard"

type JobRow = {
  id: string
  customer_id: string | null
  title: string | null
  status: string
  start_date: string | null
  end_date: string | null
  created_at: string
  customers: { name: string } | null
  materialCost: number
  materialCount: number
}

const STATUS_STYLES: Record<string, { dot: string; text: string; label: string }> = {
  draft:       { dot: "bg-slate-400",   text: "text-slate-700",   label: "Draft" },
  in_progress: { dot: "bg-blue-500",    text: "text-blue-700",    label: "In Progress" },
  completed:   { dot: "bg-emerald-500", text: "text-emerald-700", label: "Completed" },
  cancelled:   { dot: "bg-red-400",     text: "text-red-700",     label: "Cancelled" },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.draft
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
      {s.label}
    </span>
  )
}

export default function ServiceJobsPage() {
  const router = useRouter()
  const { format } = useBusinessCurrency()
  const [rows, setRows] = useState<JobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [filterStatus, setFilterStatus] = useState<string>("all")
  const debounce = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => setSearchQuery(search), 280)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [search])

  const load = async () => {
    try {
      setError("")
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) { setLoading(false); return }

      const [{ data: jobs, error: jobErr }, { data: usages }] = await Promise.all([
        supabase
          .from("service_jobs")
          .select("id, customer_id, title, status, start_date, end_date, created_at, customers(name)")
          .eq("business_id", business.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("service_job_material_usage")
          .select("job_id, total_cost")
          .eq("business_id", business.id),
      ])

      if (jobErr) { setError(jobErr.message || "Failed to load projects"); setLoading(false); return }

      // Aggregate material cost + count per job
      const costMap: Record<string, { cost: number; count: number }> = {}
      for (const u of (usages ?? []) as { job_id: string; total_cost: number }[]) {
        if (!costMap[u.job_id]) costMap[u.job_id] = { cost: 0, count: 0 }
        costMap[u.job_id].cost += Number(u.total_cost ?? 0)
        costMap[u.job_id].count += 1
      }

      setRows(
        ((jobs ?? []) as any[]).map((j) => ({
          ...j,
          customers: Array.isArray(j.customers) ? (j.customers[0] ?? null) : (j.customers ?? null),
          materialCost: costMap[j.id]?.cost ?? 0,
          materialCount: costMap[j.id]?.count ?? 0,
        }))
      )
      setLoading(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load")
      setLoading(false)
    }
  }

  // Derived stats
  const total       = rows.length
  const inProgress  = rows.filter((r) => r.status === "in_progress").length
  const completed   = rows.filter((r) => r.status === "completed").length
  const cancelled   = rows.filter((r) => r.status === "cancelled").length

  const visible = rows.filter((r) => {
    if (filterStatus !== "all" && r.status !== filterStatus) return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      const matchesTitle = (r.title ?? "").toLowerCase().includes(q)
      const matchesCustomer = (r.customers?.name ?? "").toLowerCase().includes(q)
      if (!matchesTitle && !matchesCustomer) return false
    }
    return true
  })

  const filtersActive = !!(search || filterStatus !== "all")

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("en-GH", { day: "2-digit", month: "short", year: "numeric" }) : "—"

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
            <h1 className="text-2xl font-bold text-slate-900">Projects</h1>
            <p className="text-sm text-slate-500 mt-0.5">Track service jobs, materials, and linked proformas</p>
          </div>
          <button
            onClick={() => router.push("/service/jobs/new")}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Project
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Total", value: total, icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2", bg: "bg-slate-100", iconColor: "text-slate-600" },
            { label: "In Progress", value: inProgress, icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z", bg: "bg-blue-100", iconColor: "text-blue-600", status: "in_progress" as const },
            { label: "Completed", value: completed, icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", bg: "bg-emerald-100", iconColor: "text-emerald-600", status: "completed" as const },
            { label: "Cancelled", value: cancelled, icon: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z", bg: "bg-red-100", iconColor: "text-red-500", status: "cancelled" as const },
          ].map((card) => (
            <KpiStatCard
              key={card.label}
              icon={
                <svg className={`h-5 w-5 ${card.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={card.icon} />
                </svg>
              }
              iconWrapperClassName={card.bg}
              value={card.value}
              label={card.label}
              className={"status" in card ? "hover:bg-slate-50" : undefined}
              onClick={
                "status" in card
                  ? () => {
                      const st = card.status
                      if (!st) return
                      setFilterStatus(filterStatus === st ? "all" : st)
                    }
                  : undefined
              }
            />
          ))}
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
              placeholder="Search by title or customer…"
              className="pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg bg-white w-full focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
            />
          </div>
          <MenuSelect
            value={filterStatus}
            onValueChange={setFilterStatus}
            wrapperClassName="w-auto shrink-0 min-w-[10.5rem]"
            options={[
              { value: "all", label: "All Status" },
              { value: "draft", label: "Draft" },
              { value: "in_progress", label: "In Progress" },
              { value: "completed", label: "Completed" },
              { value: "cancelled", label: "Cancelled" },
            ]}
          />
          {filtersActive && (
            <button
              onClick={() => { setSearch(""); setSearchQuery(""); setFilterStatus("all") }}
              className="px-3 py-2.5 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg bg-white transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Table / Empty state */}
        {visible.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
            <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-slate-700 font-semibold mb-1">
              {filtersActive ? "No projects match your filters" : "No projects yet"}
            </p>
            <p className="text-slate-500 text-sm mb-4">
              {filtersActive
                ? "Try adjusting your search or status filter."
                : "Create your first project to start tracking service jobs."}
            </p>
            {!filtersActive && (
              <button
                onClick={() => router.push("/service/jobs/new")}
                className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-colors"
              >
                New Project
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Project</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Start</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">End</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Materials</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Cost</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => router.push(`/service/jobs/${row.id}`)}
                      className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-sm font-medium text-slate-800">
                          {row.title ?? <span className="text-slate-400 italic">Untitled</span>}
                        </p>
                        {row.customers?.name && (
                          <p className="text-xs text-slate-400 mt-0.5">{row.customers.name}</p>
                        )}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="text-sm text-slate-500">{formatDate(row.start_date)}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="text-sm text-slate-500">{formatDate(row.end_date)}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <span className="text-sm text-slate-600 tabular-nums">{row.materialCount}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <span className="text-sm font-medium text-slate-800 tabular-nums">{format(row.materialCost)}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <span className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">
                          Open →
                        </span>
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
