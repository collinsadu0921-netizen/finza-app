"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { NativeSelect } from "@/components/ui/NativeSelect"

type Customer = { id: string; name: string }
type ProformaOption = { id: string; proforma_number: string | null; customer_name: string | null }

export default function ServiceJobsNewPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [customers, setCustomers] = useState<Customer[]>([])
  const [proformas, setProformas] = useState<ProformaOption[]>([])

  // Form fields
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [customerId, setCustomerId] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [status, setStatus] = useState("draft")
  const [proformaInvoiceId, setProformaInvoiceId] = useState("")

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business || cancelled) return

      const { data: customerData } = await supabase
        .from("customers")
        .select("id, name")
        .eq("business_id", business.id)
        .order("name")
      if (!cancelled && customerData) setCustomers(customerData as Customer[])

      const { data: proformaData } = await supabase
        .from("proforma_invoices")
        .select("id, proforma_number, customers(name)")
        .eq("business_id", business.id)
        .in("status", ["sent", "accepted"])
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
      if (!cancelled && proformaData) {
        setProformas(
          (proformaData as any[]).map((p) => ({
            id: p.id,
            proforma_number: p.proforma_number,
            customer_name: Array.isArray(p.customers) ? (p.customers[0]?.name ?? null) : (p.customers?.name ?? null),
          }))
        )
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    // Validation
    if (!title.trim()) { setError("Project title is required"); return }
    if (startDate && endDate && endDate < startDate) {
      setError("End date cannot be before the start date")
      return
    }

    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Not authenticated")
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) throw new Error("Business not found")

      const { data: job, error: err } = await supabase
        .from("service_jobs")
        .insert({
          business_id: business.id,
          title: title.trim(),
          description: description.trim() || null,
          customer_id: customerId || null,
          status,
          start_date: startDate || null,
          end_date: endDate || null,
          proforma_invoice_id: proformaInvoiceId || null,
        })
        .select("id")
        .single()
      if (err) throw err
      if (job) router.push(`/service/jobs/${job.id}`)
    } catch (e: any) {
      setError(e.message || "Failed to create project")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Header */}
        <div>
          <button
            onClick={() => router.push("/service/jobs")}
            className="text-slate-500 hover:text-slate-800 flex items-center gap-1.5 text-sm font-medium transition-colors mb-4"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Projects
          </button>
          <h1 className="text-2xl font-bold text-slate-900">New Project</h1>
          <p className="text-sm text-slate-500 mt-0.5">Create a new service engagement</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-5">

          {/* Title */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Project Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Kitchen Renovation — Smith Residence"
              required
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white placeholder:text-slate-400"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Description / Scope <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the work scope, special instructions, or client notes…"
              rows={3}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white placeholder:text-slate-400 resize-none"
            />
          </div>

          {/* Customer */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Customer <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <NativeSelect
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">— No customer —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </NativeSelect>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate || undefined}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
              />
              {startDate && endDate && endDate < startDate && (
                <p className="text-xs text-red-500 mt-1">End date must be on or after the start date.</p>
              )}
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Initial Status</label>
            <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="draft">Draft</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </NativeSelect>
          </div>

          {/* Proforma link */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Link Proforma Invoice <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <NativeSelect value={proformaInvoiceId} onChange={(e) => setProformaInvoiceId(e.target.value)}>
              <option value="">— No proforma —</option>
              {proformas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.proforma_number ?? "Draft"}{p.customer_name ? ` — ${p.customer_name}` : ""}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-slate-400 mt-1">Only sent or accepted proformas can be linked.</p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              {loading ? "Creating…" : "Create Project"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/service/jobs")}
              className="px-4 py-2.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>

      </div>
    </div>
  )
}
