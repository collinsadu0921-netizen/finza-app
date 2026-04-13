"use client"

import { useState, useEffect, useMemo, Suspense } from "react"
import { useRouter, useParams, useSearchParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useToast } from "@/components/ui/ToastProvider"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { buildServiceRoute } from "@/lib/service/routes"

type RecurringInvoice = {
  id: string
  frequency: string
  next_run_date: string
  last_run_date: string | null
  auto_send: boolean
  auto_whatsapp: boolean
  status: string
  invoice_template_data: any
  customers: {
    name: string
    email: string | null
    phone: string | null
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

function RecurringInvoiceViewContent() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const id = params.id as string
  const toast = useToast()

  const urlBusinessId = useMemo(
    () => searchParams.get("business_id")?.trim() || searchParams.get("businessId")?.trim() || null,
    [searchParams]
  )
  const withWorkspace = (path: string) => buildServiceRoute(path, urlBusinessId ?? undefined)

  const [loading, setLoading] = useState(true)
  const [recurringInvoice, setRecurringInvoice] = useState<RecurringInvoice | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    loadRecurringInvoice()
  }, [id])

  const getWorkspaceBusinessId = async (): Promise<string> => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error("Not logged in")
    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) throw new Error("Business not found")
    return business.id
  }

  const loadRecurringInvoice = async () => {
    try {
      setLoading(true)
      const businessId = await getWorkspaceBusinessId()
      const response = await fetch(
        `/api/recurring-invoices/${id}?business_id=${encodeURIComponent(businessId)}`
      )

      if (!response.ok) {
        throw new Error("Failed to load recurring invoice")
      }

      const { recurringInvoice: data } = await response.json()
      setRecurringInvoice(data)
      setError("")
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load recurring invoice")
      setLoading(false)
    }
  }

  const handleGenerateNow = async () => {
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
      setError("")
      loadRecurringInvoice()
    } catch (err: any) {
      setError(err.message || "Failed to generate invoice")
    }
  }

  const handleToggleStatus = async () => {
    if (!recurringInvoice) return

    try {
      const businessId = await getWorkspaceBusinessId()
      const newStatus = recurringInvoice.status === "active" ? "paused" : "active"
      const response = await fetch(`/api/recurring-invoices/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, status: newStatus }),
      })

      if (!response.ok) {
        throw new Error("Failed to update status")
      }

      setError("")
      loadRecurringInvoice()
    } catch (err: any) {
      setError(err.message || "Failed to update status")
    }
  }

  const formatFrequency = (frequency: string) => {
    const frequencies: Record<string, string> = {
      weekly: "Weekly",
      biweekly: "Bi-weekly",
      monthly: "Monthly",
      quarterly: "Quarterly",
      yearly: "Yearly",
    }
    return frequencies[frequency] || frequency
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <div className="text-center">
            <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-slate-500 mt-3 text-sm">Loading…</p>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  if (error || !recurringInvoice) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-slate-50 p-6">
          <div className="max-w-2xl mx-auto">
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              {error || "Recurring invoice not found"}
            </div>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  const templateData = recurringInvoice.invoice_template_data || {}
  const lineItems = templateData.line_items || []
  const totalDiscount = Array.isArray(lineItems)
    ? lineItems.reduce((sum: number, item: any) => sum + Number(item?.discount_amount || 0), 0)
    : 0

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Recurring invoice</h1>
              <p className="text-sm text-slate-500 mt-0.5">Template and schedule</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleToggleStatus}
                className={`inline-flex items-center px-3 py-2 text-sm font-semibold rounded-lg border transition-colors ${
                  recurringInvoice.status === "active"
                    ? "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
                    : "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                }`}
              >
                {recurringInvoice.status === "active" ? "Pause" : "Resume"}
              </button>
              <button
                type="button"
                onClick={() => router.push(withWorkspace(`/recurring/${id}/edit`))}
                className="inline-flex items-center px-3 py-2 text-sm font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
              >
                Edit
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Schedule</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <dt className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Customer</dt>
                <dd className="text-sm font-medium text-slate-900 mt-1">
                  {recurringInvoice.customers?.name || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Frequency</dt>
                <dd className="text-sm font-medium text-slate-900 mt-1">
                  {formatFrequency(recurringInvoice.frequency)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Next run</dt>
                <dd className="text-sm text-slate-700 mt-1">{fmt(recurringInvoice.next_run_date)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Last run</dt>
                <dd className="text-sm text-slate-700 mt-1">{fmt(recurringInvoice.last_run_date)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</dt>
                <dd className="mt-1">
                  <StatusBadge status={recurringInvoice.status} />
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Delivery</dt>
                <dd className="text-sm text-slate-700 mt-1">
                  {recurringInvoice.auto_send ? "Email · " : ""}
                  {recurringInvoice.auto_whatsapp ? "WhatsApp" : ""}
                  {!recurringInvoice.auto_send && !recurringInvoice.auto_whatsapp ? "Manual" : ""}
                </dd>
              </div>
            </dl>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Invoice template</h2>
            <div className="space-y-2">
              {lineItems.map((item: any, index: number) => (
                <div
                  key={index}
                  className="flex justify-between gap-4 items-start p-3 rounded-lg border border-slate-100 bg-slate-50/80"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{item.description}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Qty {item.qty} × GH₵{Number(item.unit_price).toFixed(2)}
                      {item.discount_amount > 0 && ` · Discount GH₵${Number(item.discount_amount).toFixed(2)}`}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-slate-900 tabular-nums shrink-0">
                    GH₵{((item.qty * item.unit_price) - (item.discount_amount || 0)).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
            {(templateData.subtotal != null || templateData.total != null) && (
              <div className="pt-4 border-t border-slate-100 space-y-1.5 text-sm">
                {templateData.apply_taxes && templateData.subtotal != null && (
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal</span>
                    <span className="font-medium text-slate-900 tabular-nums">
                      GH₵{Number(templateData.subtotal).toFixed(2)}
                    </span>
                  </div>
                )}
                {totalDiscount > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Discounts</span>
                    <span className="font-medium text-rose-600 tabular-nums">−GH₵{Number(totalDiscount).toFixed(2)}</span>
                  </div>
                )}
                {templateData.apply_taxes && Array.isArray(templateData.tax_lines?.lines) && templateData.tax_lines.lines.length > 0 && (
                  <>
                    {templateData.tax_lines.lines.map(
                      (line: { code?: string; name?: string; amount?: number }, i: number) => (
                        <div key={i} className="flex justify-between text-slate-600">
                          <span>{line.name || line.code || "Tax"}</span>
                          <span className="font-medium text-slate-900 tabular-nums">
                            GH₵{Number(line.amount || 0).toFixed(2)}
                          </span>
                        </div>
                      )
                    )}
                  </>
                )}
                {templateData.apply_taxes && templateData.total_tax != null && (
                  <div className="flex justify-between text-slate-600">
                    <span>Total tax</span>
                    <span className="font-medium text-slate-900 tabular-nums">
                      GH₵{Number(templateData.total_tax).toFixed(2)}
                    </span>
                  </div>
                )}
                {templateData.total != null && (
                  <div className="flex justify-between font-semibold text-slate-900 pt-2 border-t border-slate-100">
                    <span>Total</span>
                    <span className="tabular-nums">GH₵{Number(templateData.total).toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}
            {templateData.notes && (
              <div className="pt-4 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Notes</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{templateData.notes}</p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Actions</h2>
            <button
              type="button"
              onClick={handleGenerateNow}
              disabled={recurringInvoice.status !== "active"}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none text-white text-sm font-semibold rounded-lg shadow-sm transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Generate invoice now
            </button>
            {recurringInvoice.status !== "active" && (
              <p className="text-xs text-slate-500 mt-2">Resume the schedule to generate invoices.</p>
            )}
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}

export default function RecurringInvoiceViewPage() {
  return (
    <Suspense
      fallback={
        <ProtectedLayout>
          <div className="min-h-screen bg-slate-50 flex items-center justify-center">
            <div className="text-center">
              <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-slate-500 mt-3 text-sm">Loading…</p>
            </div>
          </div>
        </ProtectedLayout>
      }
    >
      <RecurringInvoiceViewContent />
    </Suspense>
  )
}
