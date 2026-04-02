"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { useConfirm } from "@/components/ui/ConfirmProvider"

type Job = {
  id: string
  business_id: string
  customer_id: string | null
  title: string | null
  description: string | null
  status: string
  start_date: string | null
  end_date: string | null
  invoice_id: string | null
  proforma_invoice_id: string | null
  materials_reversed?: boolean
  created_at: string
  customers?: { name: string; email: string | null; phone: string | null } | null
}

type Customer = { id: string; name: string }
type ProformaOption = { id: string; proforma_number: string | null; customer_name: string | null }

type Usage = {
  id: string
  material_id: string
  quantity_used: number
  unit_cost: number
  total_cost: number
  status: string
  created_at: string
  service_material_inventory?: { name: string; unit: string } | null
}

type Material = {
  id: string
  name: string
  unit: string
  quantity_on_hand: number
  average_cost: number
}

const STATUS_DOT: Record<string, string> = {
  draft:       "bg-slate-400",
  in_progress: "bg-blue-500",
  completed:   "bg-emerald-500",
  cancelled:   "bg-red-400",
}

const STATUS_LABEL: Record<string, string> = {
  draft:       "Draft",
  in_progress: "In Progress",
  completed:   "Completed",
  cancelled:   "Cancelled",
}

const USAGE_STATUS_STYLE: Record<string, string> = {
  allocated: "bg-amber-100 text-amber-800 border-amber-200",
  consumed:  "bg-emerald-100 text-emerald-800 border-emerald-200",
  returned:  "bg-slate-100 text-slate-600 border-slate-200",
}

export default function ServiceJobDetailPage() {
  const router = useRouter()
  const params = useParams()
  const jobId = params?.id as string
  const { format } = useBusinessCurrency()
  const { openConfirm } = useConfirm()

  const [job, setJob] = useState<Job | null>(null)
  const [usages, setUsages] = useState<Usage[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState<string | null>(null)

  // Edit mode
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [editCustomerId, setEditCustomerId] = useState("")
  const [editStartDate, setEditStartDate] = useState("")
  const [editEndDate, setEditEndDate] = useState("")
  const [editStatus, setEditStatus] = useState("")
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState("")

  // Material allocation
  const [addMaterialId, setAddMaterialId] = useState("")
  const [addQty, setAddQty] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [consumingId, setConsumingId] = useState<string | null>(null)
  const [returningId, setReturningId] = useState<string | null>(null)

  // Cancel
  const [cancelling, setCancelling] = useState(false)

  // Proforma linking
  const [proformas, setProformas] = useState<ProformaOption[]>([])
  const [linkingProforma, setLinkingProforma] = useState(false)
  const [selectedProformaId, setSelectedProformaId] = useState("")

  useEffect(() => {
    if (!jobId) return
    load()
  }, [jobId])

  const load = async () => {
    try {
      setLoading(true)
      setError("")
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) { setError("Business not found"); setLoading(false); return }
      setBusinessId(business.id)

      const [jobRes, proformaRes, usageRes, matRes, custRes] = await Promise.all([
        supabase
          .from("service_jobs")
          .select("id, business_id, customer_id, title, description, status, start_date, end_date, invoice_id, proforma_invoice_id, materials_reversed, created_at, customers(name, email, phone)")
          .eq("id", jobId)
          .eq("business_id", business.id)
          .single(),
        supabase
          .from("proforma_invoices")
          .select("id, proforma_number, customers(name)")
          .eq("business_id", business.id)
          .in("status", ["sent", "accepted"])
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        supabase
          .from("service_job_material_usage")
          .select("id, material_id, quantity_used, unit_cost, total_cost, status, created_at, service_material_inventory(name, unit)")
          .eq("job_id", jobId)
          .eq("business_id", business.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("service_material_inventory")
          .select("id, name, unit, quantity_on_hand, average_cost")
          .eq("business_id", business.id)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("customers")
          .select("id, name")
          .eq("business_id", business.id)
          .order("name"),
      ])

      if (jobRes.error || !jobRes.data) { setError("Project not found"); setLoading(false); return }

      const normalised = {
        ...jobRes.data,
        customers: Array.isArray((jobRes.data as any).customers)
          ? ((jobRes.data as any).customers[0] ?? null)
          : ((jobRes.data as any).customers ?? null),
      } as Job
      setJob(normalised)
      setSelectedProformaId(normalised.proforma_invoice_id ?? "")

      // Prime edit fields
      setEditTitle(normalised.title ?? "")
      setEditDescription(normalised.description ?? "")
      setEditCustomerId(normalised.customer_id ?? "")
      setEditStartDate(normalised.start_date ?? "")
      setEditEndDate(normalised.end_date ?? "")
      setEditStatus(normalised.status)

      setProformas(
        ((proformaRes.data ?? []) as any[]).map((p) => ({
          id: p.id,
          proforma_number: p.proforma_number,
          customer_name: Array.isArray(p.customers) ? (p.customers[0]?.name ?? null) : (p.customers?.name ?? null),
        }))
      )

      if (!usageRes.error) {
        setUsages(
          ((usageRes.data ?? []) as any[]).map((u) => ({
            ...u,
            quantity_used: Number(u.quantity_used),
            unit_cost: Number(u.unit_cost),
            total_cost: Number(u.total_cost),
            status: u.status ?? "allocated",
            service_material_inventory: Array.isArray(u.service_material_inventory)
              ? (u.service_material_inventory[0] ?? null)
              : (u.service_material_inventory ?? null),
          }))
        )
      }

      setMaterials(
        ((matRes.data ?? []) as any[]).map((m) => ({
          ...m,
          quantity_on_hand: Number(m.quantity_on_hand ?? 0),
          average_cost: Number(m.average_cost ?? 0),
        }))
      )

      setCustomers((custRes.data ?? []) as Customer[])
    } catch (e: any) {
      setError(e.message || "Failed to load project")
    } finally {
      setLoading(false)
    }
  }

  // --- Save all edits ---
  const handleSaveEdit = async () => {
    if (!job || !businessId) return
    setEditError("")

    if (!editTitle.trim()) { setEditError("Title is required"); return }
    if (editStartDate && editEndDate && editEndDate < editStartDate) {
      setEditError("End date cannot be before start date")
      return
    }

    setSavingEdit(true)
    try {
      const { error: err } = await supabase
        .from("service_jobs")
        .update({
          title: editTitle.trim(),
          description: editDescription.trim() || null,
          customer_id: editCustomerId || null,
          status: editStatus,
          start_date: editStartDate || null,
          end_date: editEndDate || null,
        })
        .eq("id", jobId)
        .eq("business_id", businessId)
      if (err) throw err
      setEditing(false)
      load()
    } catch (e: any) {
      setEditError(e.message || "Failed to save changes")
    } finally {
      setSavingEdit(false)
    }
  }

  const openEditMode = () => {
    if (!job) return
    setEditTitle(job.title ?? "")
    setEditDescription(job.description ?? "")
    setEditCustomerId(job.customer_id ?? "")
    setEditStartDate(job.start_date ?? "")
    setEditEndDate(job.end_date ?? "")
    setEditStatus(job.status)
    setEditError("")
    setEditing(true)
  }

  // --- Add material usage ---
  const handleAddUsage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!jobId || !businessId || !addMaterialId || !addQty) return
    const qty = parseFloat(addQty)
    if (isNaN(qty) || qty <= 0) { setError("Quantity must be a positive number"); return }
    setSubmitting(true)
    setError("")
    try {
      const res = await fetch("/api/service/jobs/use-material", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, job_id: jobId, material_id: addMaterialId, quantity_used: qty }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to record usage")
      setAddMaterialId("")
      setAddQty("")
      load()
    } catch (err: any) {
      setError(err.message || "Failed to record usage")
    } finally {
      setSubmitting(false)
    }
  }

  // --- Confirm consumption ---
  const handleConfirmConsumption = async (usageId: string) => {
    if (!businessId) return
    setConsumingId(usageId)
    setError("")
    try {
      const res = await fetch(`/api/service/jobs/usage/${usageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, status: "consumed" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to confirm consumption")
      load()
    } catch (err: any) {
      setError(err.message || "Failed to confirm consumption")
    } finally {
      setConsumingId(null)
    }
  }

  // --- Return allocated material ---
  const handleReturnMaterial = async (usageId: string, materialName: string) => {
    openConfirm({
      title: "Return Material",
      description: `Return "${materialName}" to stock? This will mark the allocation as returned and restore the quantity on hand.`,
      onConfirm: async () => {
        if (!businessId) return
        setReturningId(usageId)
        setError("")
        try {
          const res = await fetch(`/api/service/jobs/usage/${usageId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ business_id: businessId, status: "returned" }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || "Failed to return material")
          load()
        } catch (err: any) {
          setError(err.message || "Failed to return material")
        } finally {
          setReturningId(null)
        }
      },
    })
  }

  // --- Proforma link/unlink ---
  const handleLinkProforma = async (newId: string | null) => {
    if (!jobId || !businessId) return
    setLinkingProforma(true)
    setError("")
    try {
      const { error: err } = await supabase
        .from("service_jobs")
        .update({ proforma_invoice_id: newId })
        .eq("id", jobId)
        .eq("business_id", businessId)
      if (err) throw err
      setJob((j) => j ? { ...j, proforma_invoice_id: newId } : j)
      setSelectedProformaId(newId ?? "")
    } catch (e: any) {
      setError(e.message || "Failed to update proforma link")
    } finally {
      setLinkingProforma(false)
    }
  }

  // --- Cancel project ---
  const handleCancelJob = () => {
    openConfirm({
      title: "Cancel Project",
      description: "Cancelling will restore all material stock and reverse any COGS entries. This cannot be undone.",
      onConfirm: async () => {
        setCancelling(true)
        setError("")
        try {
          const q = businessId ? `?business_id=${encodeURIComponent(businessId)}` : ""
          const res = await fetch(`/api/service/jobs/${jobId}/cancel${q}`, { method: "POST" })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || "Failed to cancel project")
          load()
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : "Failed to cancel project")
        } finally {
          setCancelling(false)
        }
      },
    })
  }

  // --- Convert to Invoice ---
  const handleConvertToInvoice = () => {
    if (!job) return
    const params = new URLSearchParams()
    if (job.customer_id) params.set("customer_id", job.customer_id)
    if (job.title) params.set("notes", `Project: ${job.title}`)
    params.set("from_job", jobId)
    router.push(`/service/invoices/new?${params.toString()}`)
  }

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

  if (!job) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-start justify-center p-8">
        <div className="w-full max-w-md space-y-4">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
            {error || "Project not found."}
          </div>
          <button onClick={() => router.push("/service/jobs")} className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-colors">
            Back to Projects
          </button>
        </div>
      </div>
    )
  }

  const totalCost = usages.reduce((s, u) => s + u.total_cost, 0)
  const addQtyNum = parseFloat(addQty)
  const canSubmitUsage = addMaterialId && !isNaN(addQtyNum) && addQtyNum > 0
  const isCancelled = job.status === "cancelled"
  const materialsAlreadyReversed = job.materials_reversed === true
  const showCancelButton = !isCancelled && !materialsAlreadyReversed
  const showInvoiceButton = !isCancelled && !job.invoice_id
  const selectedMaterial = addMaterialId ? materials.find((m) => m.id === addMaterialId) : null

  // Duplicate material warning: same material already allocated and not returned
  const allocatedMaterialIds = new Set(
    usages.filter((u) => u.status !== "returned").map((u) => u.material_id)
  )
  const isDuplicateMaterial = addMaterialId && allocatedMaterialIds.has(addMaterialId)

  const linkedProforma = job.proforma_invoice_id
    ? proformas.find((p) => p.id === job.proforma_invoice_id) ?? null
    : null

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("en-GH", { day: "2-digit", month: "short", year: "numeric" }) : "—"

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Back */}
        <button
          onClick={() => router.push("/service/jobs")}
          className="text-slate-500 hover:text-slate-800 flex items-center gap-1.5 text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Projects
        </button>

        {/* Header card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-xl font-bold text-slate-900">
                  {job.title ?? <span className="text-slate-400 italic font-normal">Untitled Project</span>}
                </h1>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  <span className={`w-2 h-2 rounded-full ${STATUS_DOT[job.status] ?? "bg-slate-400"}`} />
                  {STATUS_LABEL[job.status] ?? job.status}
                </span>
              </div>
              {job.customers?.name && (
                <p className="text-sm text-slate-500">
                  {job.customers.name}
                  {job.customers.email && <> · {job.customers.email}</>}
                </p>
              )}
              {job.description && (
                <p className="text-sm text-slate-500 mt-2 max-w-xl">{job.description}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!isCancelled && (
                <button
                  onClick={openEditMode}
                  className="px-3 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors"
                >
                  Edit
                </button>
              )}
              {showInvoiceButton && (
                <button
                  onClick={handleConvertToInvoice}
                  className="px-3 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
                >
                  → Invoice
                </button>
              )}
              {showCancelButton && (
                <button
                  onClick={handleCancelJob}
                  disabled={cancelling}
                  className="px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50"
                >
                  {cancelling ? "Cancelling…" : "Cancel Project"}
                </button>
              )}
              {materialsAlreadyReversed && (
                <span className="text-xs text-amber-600 font-medium px-2.5 py-1 bg-amber-50 rounded-lg border border-amber-200">
                  Materials reversed
                </span>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
        )}

        {/* Edit panel */}
        {editing && (
          <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Edit Project</h2>
              <button onClick={() => setEditing(false)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>

            {editError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">{editError}</div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Description / Scope</label>
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white resize-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Customer</label>
                <select
                  value={editCustomerId}
                  onChange={(e) => setEditCustomerId(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
                >
                  <option value="">— No customer —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
                >
                  <option value="draft">Draft</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Start Date</label>
                <input
                  type="date"
                  value={editStartDate}
                  onChange={(e) => setEditStartDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">End Date</label>
                <input
                  type="date"
                  value={editEndDate}
                  onChange={(e) => setEditEndDate(e.target.value)}
                  min={editStartDate || undefined}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
                />
                {editStartDate && editEndDate && editEndDate < editStartDate && (
                  <p className="text-xs text-red-500 mt-1">End date must be on or after start date.</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
              <button
                onClick={handleSaveEdit}
                disabled={savingEdit}
                className="px-5 py-2.5 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                {savingEdit ? "Saving…" : "Save Changes"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Details card (read-only, hidden when editing) */}
        {!editing && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
            <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Details</h2>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
              <div>
                <p className="text-xs text-slate-500 mb-1">Status</p>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                  <span className={`w-2 h-2 rounded-full ${STATUS_DOT[job.status] ?? "bg-slate-400"}`} />
                  {STATUS_LABEL[job.status] ?? job.status}
                </span>
              </div>

              <div>
                <p className="text-xs text-slate-500 mb-1">Start Date</p>
                <p className="text-sm font-semibold text-slate-800">{formatDate(job.start_date)}</p>
              </div>

              <div>
                <p className="text-xs text-slate-500 mb-1">End Date</p>
                <p className="text-sm font-semibold text-slate-800">{formatDate(job.end_date)}</p>
              </div>

              {job.customers?.name && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Customer</p>
                  <p className="text-sm font-semibold text-slate-800">{job.customers.name}</p>
                </div>
              )}

              {job.invoice_id && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Linked Invoice</p>
                  <button
                    onClick={() => router.push(`/service/invoices/${job.invoice_id}/view`)}
                    className="text-sm font-semibold text-blue-600 hover:underline"
                  >
                    View Invoice →
                  </button>
                </div>
              )}
            </div>

            {/* Proforma section */}
            <div className="pt-5 border-t border-slate-100">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-3 font-semibold">Linked Proforma</p>
              {job.proforma_invoice_id && linkedProforma ? (
                <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-indigo-800">
                      {linkedProforma.proforma_number ? `PRF — ${linkedProforma.proforma_number}` : "Draft Proforma"}
                    </p>
                    {linkedProforma.customer_name && (
                      <p className="text-xs text-indigo-500 mt-0.5">{linkedProforma.customer_name}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => router.push(`/service/proforma/${job.proforma_invoice_id}/view`)}
                      className="text-sm font-medium text-indigo-600 hover:underline"
                    >
                      View
                    </button>
                    <button
                      onClick={() => handleLinkProforma(null)}
                      disabled={linkingProforma}
                      className="text-sm text-slate-400 hover:text-red-500 transition-colors disabled:opacity-50"
                    >
                      Unlink
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <select
                    value={selectedProformaId}
                    onChange={(e) => setSelectedProformaId(e.target.value)}
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
                  >
                    <option value="">— No proforma linked —</option>
                    {proformas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.proforma_number ?? "Draft"}{p.customer_name ? ` — ${p.customer_name}` : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleLinkProforma(selectedProformaId || null)}
                    disabled={linkingProforma || !selectedProformaId}
                    className="px-3 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                  >
                    {linkingProforma ? "Saving…" : "Link"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Materials card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Materials Used</h2>
            {usages.length > 0 && (
              <span className="text-sm font-semibold text-slate-800">Total: {format(totalCost)}</span>
            )}
          </div>

          {/* Allocate form — only when not cancelled */}
          {!isCancelled && (
            <form onSubmit={handleAddUsage} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Allocate Material</p>
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[200px]">
                  <select
                    value={addMaterialId}
                    onChange={(e) => setAddMaterialId(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
                  >
                    <option value="">Select material…</option>
                    {materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} — {Number(m.quantity_on_hand)} {m.unit} on hand
                      </option>
                    ))}
                  </select>
                  {selectedMaterial && Number(selectedMaterial.quantity_on_hand) === 0 && (
                    <p className="text-xs text-amber-600 mt-1">⚠ No stock available. Adjust via Materials → Adjust Stock.</p>
                  )}
                  {isDuplicateMaterial && (
                    <p className="text-xs text-amber-600 mt-1">⚠ This material is already allocated to this project. Adding again will create a second line.</p>
                  )}
                </div>
                <div>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={addQty}
                    onChange={(e) => setAddQty(e.target.value)}
                    placeholder="Qty"
                    className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting || !canSubmitUsage}
                  className="px-4 py-2.5 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 disabled:opacity-40 transition-colors"
                >
                  {submitting ? "Saving…" : "Allocate"}
                </button>
              </div>
            </form>
          )}

          {/* Usage table */}
          {usages.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">
              No materials allocated yet.{!isCancelled && " Allocate a material above, then confirm consumption to post COGS."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="pb-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Material</th>
                    <th className="pb-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Qty</th>
                    <th className="pb-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Unit Cost</th>
                    <th className="pb-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Total</th>
                    <th className="pb-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider pl-4">Status</th>
                    <th className="pb-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</th>
                    <th className="pb-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {usages.map((u) => (
                    <tr key={u.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-3 text-sm font-medium text-slate-800">
                        {u.service_material_inventory?.name ?? <span className="text-slate-400 font-mono text-xs">{u.material_id.slice(0, 8)}</span>}
                        {u.service_material_inventory?.unit && (
                          <span className="text-xs text-slate-400 ml-1">({u.service_material_inventory.unit})</span>
                        )}
                      </td>
                      <td className="py-3 text-right text-sm tabular-nums text-slate-700">{u.quantity_used}</td>
                      <td className="py-3 text-right text-sm tabular-nums text-slate-600">{format(u.unit_cost)}</td>
                      <td className="py-3 text-right text-sm tabular-nums font-medium text-slate-900">{format(u.total_cost)}</td>
                      <td className="py-3 pl-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${USAGE_STATUS_STYLE[u.status] ?? USAGE_STATUS_STYLE.allocated}`}>
                          {u.status.charAt(0).toUpperCase() + u.status.slice(1)}
                        </span>
                      </td>
                      <td className="py-3 text-right text-xs text-slate-400">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString("en-GH", { day: "2-digit", month: "short" }) : "—"}
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {u.status === "allocated" && (
                            <>
                              <button
                                onClick={() => handleConfirmConsumption(u.id)}
                                disabled={consumingId === u.id}
                                className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                              >
                                {consumingId === u.id ? "Posting…" : "Confirm"}
                              </button>
                              <button
                                onClick={() => handleReturnMaterial(u.id, u.service_material_inventory?.name ?? "material")}
                                disabled={returningId === u.id}
                                className="text-xs font-medium text-slate-400 hover:text-red-500 transition-colors disabled:opacity-50"
                              >
                                {returningId === u.id ? "…" : "Return"}
                              </button>
                            </>
                          )}
                          {u.status === "consumed" && businessId && (
                            <a
                              href={`/service/ledger?business_id=${businessId}&reference_type=service_job_usage&reference_id=${u.id}`}
                              className="text-xs font-medium text-blue-600 hover:underline"
                            >
                              Ledger →
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200">
                    <td colSpan={3} className="pt-3 text-sm font-bold text-slate-900">Total Material Cost</td>
                    <td className="pt-3 text-right text-sm font-bold text-slate-900 tabular-nums">{format(totalCost)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
