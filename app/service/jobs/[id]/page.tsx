"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import LoadingScreen from "@/components/ui/LoadingScreen"
import PageHeader from "@/components/ui/PageHeader"
import Button from "@/components/ui/Button"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"

type Job = {
  id: string
  business_id: string
  customer_id: string | null
  status: string
  start_date: string | null
  end_date: string | null
  invoice_id: string | null
  materials_reversed?: boolean
  created_at: string
  customers?: { name: string; email: string | null; phone: string | null } | null
}

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

export default function ServiceJobDetailPage() {
  const router = useRouter()
  const params = useParams()
  const jobId = params?.id as string
  const { format } = useBusinessCurrency()
  const [job, setJob] = useState<Job | null>(null)
  const [usages, setUsages] = useState<Usage[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [addMaterialId, setAddMaterialId] = useState("")
  const [addQty, setAddQty] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [consumingId, setConsumingId] = useState<string | null>(null)

  useEffect(() => {
    if (!jobId) return
    load()
  }, [jobId])

  const load = async () => {
    try {
      setLoading(true)
      setError("")
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }
      setBusinessId(business.id)

      const { data: jobData, error: jobErr } = await supabase
        .from("service_jobs")
        .select("id, business_id, customer_id, status, start_date, end_date, invoice_id, materials_reversed, created_at, customers(name, email, phone)")
        .eq("id", jobId)
        .eq("business_id", business.id)
        .single()
      if (jobErr || !jobData) {
        setError("Job not found")
        setLoading(false)
        return
      }
      setJob(jobData as unknown as Job)

      const { data: usageData, error: usageErr } = await supabase
        .from("service_job_material_usage")
        .select("id, material_id, quantity_used, unit_cost, total_cost, status, created_at, service_material_inventory(name, unit)")
        .eq("job_id", jobId)
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })
      if (!usageErr) setUsages((usageData || []).map((u) => ({ ...u, quantity_used: Number(u.quantity_used), unit_cost: Number(u.unit_cost), total_cost: Number(u.total_cost), status: (u as any).status ?? 'allocated', service_material_inventory: Array.isArray((u as any).service_material_inventory) ? ((u as any).service_material_inventory[0] ?? { name: '', unit: '' }) : ((u as any).service_material_inventory ?? { name: '', unit: '' }) })) as Usage[])

      const { data: matData } = await supabase
        .from("service_material_inventory")
        .select("id, name, unit, quantity_on_hand, average_cost")
        .eq("business_id", business.id)
        .eq("is_active", true)
        .order("name")
      setMaterials(
        (matData || []).map((m) => ({
          ...m,
          quantity_on_hand: Number(m.quantity_on_hand ?? 0),
          average_cost: Number(m.average_cost ?? 0),
        }))
      )
    } catch (e: any) {
      setError(e.message || "Failed to load job")
    } finally {
      setLoading(false)
    }
  }

  const handleAddUsage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!jobId || !businessId || !addMaterialId || !addQty) return
    const qty = parseFloat(addQty)
    if (isNaN(qty) || qty <= 0) {
      setError("Quantity must be a positive number")
      return
    }
    setSubmitting(true)
    setError("")
    try {
      const res = await fetch("/api/service/jobs/use-material", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          job_id: jobId,
          material_id: addMaterialId,
          quantity_used: qty,
        }),
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

  const handleConfirmConsumption = async (usageId: string) => {
    setConsumingId(usageId)
    setError("")
    try {
      const res = await fetch(`/api/service/jobs/usage/${usageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "consumed" }),
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

  const handleCancelJob = async () => {
    if (!jobId || !window.confirm("Cancel this job? Material stock will be restored and COGS reversed.")) return
    setCancelling(true)
    setError("")
    try {
      const res = await fetch(`/api/service/jobs/${jobId}/cancel`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to cancel job")
      load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to cancel job")
    } finally {
      setCancelling(false)
    }
  }

  if (loading) return <LoadingScreen />

  if (!job) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-8 text-center">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Job not found</h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              This job does not exist or you do not have access to it.
            </p>
            <button
              onClick={() => router.push("/service/jobs")}
              className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              Back to Jobs
            </button>
          </div>
        </div>
      </div>
    )
  }

  const totalCost = usages.reduce((s, u) => s + u.total_cost, 0)
  const addQtyNum = parseFloat(addQty)
  const canSubmitUsage = addMaterialId && !isNaN(addQtyNum) && addQtyNum > 0
  const selectedMaterial = addMaterialId ? materials.find((m) => m.id === addMaterialId) : null
  const isCancelled = job.status === "cancelled"
  const materialsAlreadyReversed = job.materials_reversed === true
  const showCancelButton = !isCancelled && !materialsAlreadyReversed

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PageHeader
          title={`Job ${job.status}`}
          subtitle={(job as any).customers?.name ? `Customer: ${(job as any).customers.name}` : "No customer"}
          actions={
            <div className="flex items-center gap-2">
              {showCancelButton && (
                <Button
                  variant="outline"
                  onClick={handleCancelJob}
                  disabled={cancelling}
                  className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  {cancelling ? "Cancelling..." : "Cancel Job"}
                </Button>
              )}
              {materialsAlreadyReversed && (
                <span className="text-sm text-amber-600 dark:text-amber-400">Materials already reversed.</span>
              )}
              <Button variant="outline" onClick={() => router.push("/service/jobs")}>
                Back to Jobs
              </Button>
            </div>
          }
        />
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        <div className="grid gap-6">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Details</h2>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-gray-500 dark:text-gray-400">Status</dt>
              <dd className="font-medium">{job.status}</dd>
              <dt className="text-gray-500 dark:text-gray-400">Start date</dt>
              <dd>{job.start_date ? new Date(job.start_date).toLocaleDateString() : "—"}</dd>
              <dt className="text-gray-500 dark:text-gray-400">End date</dt>
              <dd>{job.end_date ? new Date(job.end_date).toLocaleDateString() : "—"}</dd>
            </dl>
          </div>

          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Materials Used</h2>
            <form onSubmit={handleAddUsage} className="flex flex-wrap gap-4 mb-6">
              <div>
                <select
                  value={addMaterialId}
                  onChange={(e) => setAddMaterialId(e.target.value)}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
                >
                  <option value="">Select material</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} — {Number(m.quantity_on_hand ?? 0)} on hand (unit: {m.unit})
                    </option>
                  ))}
                </select>
                {selectedMaterial && (
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    On hand: <strong>{Number(selectedMaterial.quantity_on_hand ?? 0)}</strong> {selectedMaterial.unit}
                    {Number(selectedMaterial.quantity_on_hand ?? 0) === 0 && (
                      <span className="block mt-1 text-amber-600 dark:text-amber-400">
                        Add stock via Service Inventory → Adjust, or Materials → Add stock.
                      </span>
                    )}
                  </p>
                )}
              </div>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={addQty}
                onChange={(e) => setAddQty(e.target.value)}
                placeholder="Qty"
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 w-24 dark:bg-gray-700 dark:text-white"
              />
              <Button type="submit" disabled={submitting || !canSubmitUsage}>
                {submitting ? "Saving..." : "Allocate Material"}
              </Button>
            </form>
            {usages.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 text-sm">No materials recorded yet. Allocate a material above; then confirm consumption to post to the ledger.</p>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold text-gray-700 dark:text-gray-300">Material</th>
                      <th className="px-4 py-2 text-right font-semibold text-gray-700 dark:text-gray-300">Quantity</th>
                      <th className="px-4 py-2 text-right font-semibold text-gray-700 dark:text-gray-300">Cost</th>
                      <th className="px-4 py-2 text-left font-semibold text-gray-700 dark:text-gray-300">Status</th>
                      <th className="px-4 py-2 text-right font-semibold text-gray-700 dark:text-gray-300">Date</th>
                      <th className="px-4 py-2 text-right font-semibold text-gray-700 dark:text-gray-300">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {usages.map((u) => (
                      <tr key={u.id}>
                        <td className="px-4 py-2 text-gray-900 dark:text-gray-100">
                          {(u as any).service_material_inventory?.name ?? u.material_id}
                        </td>
                        <td className="px-4 py-2 text-right">{u.quantity_used}</td>
                        <td className="px-4 py-2 text-right font-medium">{format(u.total_cost)}</td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                            u.status === "consumed" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" :
                            u.status === "returned" ? "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300" :
                            "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                          }`}>
                            {u.status ?? "allocated"}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400">
                          {u.created_at ? new Date(u.created_at).toLocaleString() : "—"}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {u.status === "allocated" && (
                            <button
                              type="button"
                              onClick={() => handleConfirmConsumption(u.id)}
                              disabled={consumingId === u.id}
                              className="text-blue-600 dark:text-blue-400 hover:underline font-medium disabled:opacity-50"
                            >
                              {consumingId === u.id ? "Posting…" : "Confirm consumption"}
                            </button>
                          )}
                          {u.status === "consumed" && businessId && (
                            <a
                              href={`/service/ledger?business_id=${businessId}&reference_type=service_job_usage&reference_id=${u.id}`}
                              className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                            >
                              View in Ledger
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-4 text-right font-semibold text-gray-900 dark:text-gray-100">
                  Total cost: {format(totalCost)}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
