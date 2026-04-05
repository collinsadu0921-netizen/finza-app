"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { resolveServiceBusinessContext } from "@/lib/serviceBusinessContext"
import { formatMoney } from "@/lib/money"
import { buildAccountingRoute } from "@/lib/accounting/routes"
import { MenuSelect } from "@/components/ui/MenuSelect"

type ActivityRow = {
  journal_entry_id: string
  date: string
  reference_type: string | null
  reference_id: string | null
  vendor_name: string
  account_name: string
  account_code: string
  amount: number
  description: string | null
  created_at: string
}

const SOURCE_LABELS: Record<string, string> = {
  expense: "Manual",
  bill: "Bill",
  adjustment_journal: "Adjustment",
  reconciliation: "Reconciliation",
}

function getViewLink(row: ActivityRow, businessId: string | null): { href: string; label: string } {
  const ledgerHref = businessId
    ? buildAccountingRoute("/accounting/ledger", businessId)
    : "/accounting"
  const ledgerHighlight =
    businessId && row.journal_entry_id
      ? `${buildAccountingRoute("/accounting/ledger", businessId)}&highlight=${row.journal_entry_id}`
      : ledgerHref
  const reconHref = businessId
    ? buildAccountingRoute("/accounting/reconciliation", businessId)
    : "/accounting"
  if (row.reference_type === "expense" && row.reference_id) {
    return { href: `/service/expenses/${row.reference_id}/view`, label: "View" }
  }
  if (row.reference_type === "bill" && row.reference_id) {
    return { href: `/bills/${row.reference_id}/view`, label: "View" }
  }
  if (row.reference_type === "adjustment_journal") {
    return { href: ledgerHighlight, label: "Ledger" }
  }
  if (row.reference_type === "reconciliation" && row.reference_id) {
    return { href: reconHref, label: "Reconcile" }
  }
  return { href: ledgerHref, label: "Ledger" }
}

function SourceBadge({ referenceType }: { referenceType: string | null }) {
  const label = referenceType ? SOURCE_LABELS[referenceType] ?? referenceType : "—"
  const style =
    referenceType === "bill"
      ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
      : referenceType === "expense"
        ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
        : referenceType === "adjustment_journal"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
          : referenceType === "reconciliation"
            ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
            : "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {label}
    </span>
  )
}

export default function ServiceExpensesActivityPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [noContext, setNoContext] = useState(false)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [currencyCode, setCurrencyCode] = useState<string>("GHS")
  const [rows, setRows] = useState<ActivityRow[]>([])
  const [totalExpensesInRange, setTotalExpensesInRange] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [filters, setFilters] = useState({
    startDate: "",
    endDate: "",
    sourceType: "",
  })

  const loadContext = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError("Not authenticated")
      return
    }
    const ctx = await resolveServiceBusinessContext(supabase, user.id)
    if ("error" in ctx) {
      setNoContext(true)
      return
    }
    setBusinessId(ctx.businessId)
    const { data: biz } = await supabase
      .from("businesses")
      .select("default_currency")
      .eq("id", ctx.businessId)
      .single()
    setCurrencyCode(biz?.default_currency ?? "GHS")
  }, [])

  const loadActivity = useCallback(
    async (cursor: string | null = null) => {
      if (!businessId) return
      setLoading(true)
      setError("")
      try {
        const params = new URLSearchParams()
        params.set("businessId", businessId)
        if (filters.startDate) params.set("startDate", filters.startDate)
        if (filters.endDate) params.set("endDate", filters.endDate)
        params.set("limit", "100")
        if (cursor) params.set("cursor", cursor)

        const res = await fetch(`/api/service/expenses/activity?${params}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data.error || "Failed to load expense activity")
        }
        const newRows = data.rows ?? []
        setRows((prev) => (cursor ? [...prev, ...newRows] : newRows))
        setTotalExpensesInRange(data.totalExpensesInRange ?? 0)
        setNextCursor(data.nextCursor ?? null)
      } catch (e: any) {
        setError(e.message || "Failed to load")
        if (!cursor) {
          setRows([])
          setTotalExpensesInRange(0)
          setNextCursor(null)
        }
      } finally {
        setLoading(false)
      }
    },
    [businessId, filters.startDate, filters.endDate]
  )

  useEffect(() => {
    let cancelled = false
    loadContext().then(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [loadContext])

  useEffect(() => {
    if (businessId) loadActivity(null)
  }, [businessId, filters.startDate, filters.endDate, loadActivity])

  if (noContext) {
    return (
      
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-6 text-amber-800 dark:text-amber-200">
              <p className="font-medium">No business found.</p>
              <p className="text-sm mt-1">Ensure you have an active business to view expense activity.</p>
              <button onClick={() => router.push("/service/dashboard")} className="mt-4 text-sm text-amber-700 dark:text-amber-300 hover:underline">← Back to Dashboard</button>
            </div>
          </div>
        </div>
      
    )
  }

  return (
    
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-between items-center mb-8">
            <div>
              <button onClick={() => router.push("/service/dashboard")} className="text-blue-600 dark:text-blue-400 hover:underline mb-2 text-sm">← Back to Dashboard</button>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">Expense Activity</h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">Shows all expense transactions across the business</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Service workspace · Ledger-derived</p>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">{error}</div>
          )}

          {/* Totals panel */}
          <div className="rounded-xl border border-gray-200/80 bg-white/80 dark:bg-gray-800/80 backdrop-blur shadow-sm dark:border-gray-700/80 p-6 mb-6">
            <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Total expenses (selected range)</h2>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{formatMoney(totalExpensesInRange, currencyCode || "GHS")}</p>
          </div>

          {/* Filters */}
          <div className="rounded-xl border border-gray-200/80 bg-white/80 dark:bg-gray-800/80 backdrop-blur shadow-sm dark:border-gray-700/80 p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Start date</label>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">End date</label>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Source type</label>
                <MenuSelect
                  value={filters.sourceType}
                  onValueChange={(v) => setFilters((f) => ({ ...f, sourceType: v }))}
                  options={[
                    { value: "", label: "All sources" },
                    { value: "expense", label: "Manual expense" },
                    { value: "bill", label: "Bill" },
                    { value: "adjustment_journal", label: "Adjustment" },
                    { value: "reconciliation", label: "Reconciliation" },
                  ]}
                />
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="rounded-xl border border-gray-200/80 bg-white/80 dark:bg-gray-800/80 backdrop-blur shadow-sm dark:border-gray-700/80 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase">Vendor</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase">Account</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold uppercase">Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase">Source</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase">Description</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase w-24">View</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {loading && rows.length === 0 ? (
                    [1, 2, 3, 4, 5].map((i) => (
                      <tr key={i} className="animate-pulse">
                        <td className="px-6 py-4"><div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-24" /></td>
                        <td className="px-6 py-4"><div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-32" /></td>
                        <td className="px-6 py-4"><div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-28" /></td>
                        <td className="px-6 py-4"><div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-20 ml-auto" /></td>
                        <td className="px-6 py-4"><div className="h-5 bg-gray-200 dark:bg-gray-600 rounded w-16" /></td>
                        <td className="px-6 py-4"><div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-40" /></td>
                        <td className="px-6 py-4"><div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-12" /></td>
                      </tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                        <p className="font-medium">No expense activity</p>
                        <p className="text-sm mt-1">Expenses will appear here once posted to the ledger.</p>
                      </td>
                    </tr>
                  ) : (
                    rows
                      .filter((r) => !filters.sourceType || r.reference_type === filters.sourceType)
                      .map((row) => {
                        const view = getViewLink(row, businessId)
                        return (
                          <tr key={`${row.journal_entry_id}-${row.account_code}-${row.amount}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                              {new Date(row.date).toLocaleDateString()}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">{row.vendor_name || "—"}</td>
                            <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                              {row.account_name || row.account_code || "—"}
                            </td>
                            <td className="px-6 py-4 text-sm text-right font-medium text-gray-900 dark:text-white">
                              {formatMoney(row.amount, currencyCode || "GHS")}
                            </td>
                            <td className="px-6 py-4"><SourceBadge referenceType={row.reference_type} /></td>
                            <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 max-w-xs truncate" title={row.description ?? ""}>
                              {row.description || "—"}
                            </td>
                            <td className="px-6 py-4">
                              <Link href={view.href} className="text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium">
                                {view.label}
                              </Link>
                            </td>
                          </tr>
                        )
                      })
                  )}
                </tbody>
              </table>
            </div>
            {nextCursor && rows.length > 0 && (
              <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-center">
                <button
                  type="button"
                  onClick={() => loadActivity(nextCursor)}
                  disabled={loading}
                  className="px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 disabled:opacity-50"
                >
                  {loading ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    
  )
}
