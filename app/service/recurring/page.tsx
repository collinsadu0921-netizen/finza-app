"use client"

import { useState, useEffect, useMemo, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { buildServiceRoute } from "@/lib/service/routes"
import { useToast } from "@/components/ui/ToastProvider"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { MenuSelect } from "@/components/ui/MenuSelect"

type RecurringInvoice = {
  id: string
  frequency: string
  next_run_date: string
  auto_send: boolean
  auto_whatsapp: boolean
  status: string
  last_run_date: string | null
  customers: {
    name: string
    email: string | null
  } | null
}

const STATUS_BADGE: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  active: { label: "Active", dot: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-800" },
  paused: { label: "Paused", dot: "bg-slate-400", bg: "bg-slate-100", text: "text-slate-600" },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_BADGE[status] ?? STATUS_BADGE.paused
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

function fmt(dateString: string | null) {
  if (!dateString) return "—"
  return new Date(dateString).toLocaleDateString("en-GH", { year: "numeric", month: "short", day: "numeric" })
}

function formatFrequency(frequency: string) {
  const frequencies: Record<string, string> = {
    weekly: "Weekly",
    biweekly: "Bi-weekly",
    monthly: "Monthly",
    quarterly: "Quarterly",
    yearly: "Yearly",
  }
  return frequencies[frequency] || frequency
}

function RecurringInvoicesPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const urlBusinessId = useMemo(
    () => searchParams.get("business_id")?.trim() || searchParams.get("businessId")?.trim() || null,
    [searchParams]
  )
  const withWorkspace = (path: string) => buildServiceRoute(path, urlBusinessId ?? undefined)

  const [loading, setLoading] = useState(true)
  const [recurringInvoices, setRecurringInvoices] = useState<RecurringInvoice[]>([])
  const [error, setError] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  const getWorkspaceBusinessId = async (): Promise<string> => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error("Not logged in")
    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) throw new Error("Business not found")
    return business.id
  }

  useEffect(() => {
    loadRecurringInvoices()
  }, [statusFilter])

  const loadRecurringInvoices = async () => {
    try {
      setLoading(true)
      const businessId = await getWorkspaceBusinessId()
      const params = new URLSearchParams()
      params.append("business_id", businessId)
      if (statusFilter !== "all") params.append("status", statusFilter)

      const response = await fetch(`/api/recurring-invoices/list?${params.toString()}`)
      if (!response.ok) {
        throw new Error("Failed to load recurring invoices")
      }

      const { recurringInvoices: data } = await response.json()
      setRecurringInvoices(data || [])
      setError("")
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load recurring invoices")
      setLoading(false)
    }
  }

  const handleToggleStatus = async (id: string, currentStatus: string) => {
    try {
      const businessId = await getWorkspaceBusinessId()
      const newStatus = currentStatus === "active" ? "paused" : "active"
      const response = await fetch(`/api/recurring-invoices/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, status: newStatus }),
      })

      if (!response.ok) {
        throw new Error("Failed to update status")
      }

      loadRecurringInvoices()
    } catch (err: any) {
      setError(err.message || "Failed to update status")
    }
  }

  const handleGenerateNow = async (id: string) => {
    try {
      const businessId = await getWorkspaceBusinessId()
      const response = await fetch("/api/recurring-invoices/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, recurring_invoice_id: id }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to generate invoice")
      }

      const { invoice, whatsappInfo } = await response.json()

      if (whatsappInfo?.url) {
        window.open(whatsappInfo.url, "_blank", "noopener,noreferrer")
      }

      const label = invoice.invoice_number || invoice.id?.slice(0, 8) || "draft"
      toast.showToast(`Invoice ${label} generated successfully!`, "success")
      loadRecurringInvoices()
    } catch (err: any) {
      setError(err.message || "Failed to generate invoice")
    }
  }

  const count = recurringInvoices.length
  const hasFilters = statusFilter !== "all"

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-500 mt-3 text-sm">Loading recurring invoices…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Recurring invoices</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {count} schedule{count !== 1 ? "s" : ""}
              {hasFilters ? " matching filters" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push(withWorkspace("/recurring/create"))}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            New recurring invoice
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Status</span>
            <MenuSelect
              value={statusFilter}
              onValueChange={setStatusFilter}
              wrapperClassName="w-auto min-w-[10rem]"
              options={[
                { value: "all", label: "All" },
                { value: "active", label: "Active" },
                { value: "paused", label: "Paused" },
              ]}
            />
            {hasFilters && (
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 font-medium transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear filter
              </button>
            )}
          </div>
        </div>

        {count === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-16 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </div>
            <p className="text-slate-600 font-semibold text-lg">No recurring invoices</p>
            <p className="text-slate-400 text-sm mt-1 mb-6">
              {hasFilters ? "Try changing the status filter" : "Create a template to generate invoices on a schedule"}
            </p>
            {!hasFilters && (
              <button
                type="button"
                onClick={() => router.push(withWorkspace("/recurring/create"))}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                New recurring invoice
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70">
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Customer
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Frequency
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Next run
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Last run
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Delivery
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-5 py-3.5 text-right text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recurringInvoices.map((recurring) => (
                    <tr key={recurring.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-4">
                        <span className="text-sm font-medium text-slate-800">
                          {recurring.customers?.name || <span className="text-slate-400 font-normal">No customer</span>}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-sm text-slate-600">{formatFrequency(recurring.frequency)}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-sm text-slate-600">{fmt(recurring.next_run_date)}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-sm text-slate-500">{fmt(recurring.last_run_date)}</span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {recurring.auto_send && (
                            <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700">
                              Email
                            </span>
                          )}
                          {recurring.auto_whatsapp && (
                            <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800">
                              WhatsApp
                            </span>
                          )}
                          {!recurring.auto_send && !recurring.auto_whatsapp && (
                            <span className="text-xs text-slate-400">Manual</span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={recurring.status} />
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            title="Generate now"
                            onClick={() => handleGenerateNow(recurring.id)}
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => router.push(withWorkspace(`/recurring/${recurring.id}/view`))}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                          >
                            View
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => router.push(withWorkspace(`/recurring/${recurring.id}/edit`))}
                            className="text-xs font-semibold text-slate-600 hover:text-slate-900 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(recurring.id, recurring.status)}
                            className={`text-xs font-semibold px-2 py-1 rounded-lg transition-colors ${
                              recurring.status === "active"
                                ? "text-amber-700 hover:bg-amber-50"
                                : "text-emerald-700 hover:bg-emerald-50"
                            }`}
                          >
                            {recurring.status === "active" ? "Pause" : "Resume"}
                          </button>
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

export default function RecurringInvoicesPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <div className="text-center">
            <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-slate-500 mt-3 text-sm">Loading…</p>
          </div>
        </div>
      }
    >
      <RecurringInvoicesPageContent />
    </Suspense>
  )
}
