"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import LoadingScreen from "@/components/ui/LoadingScreen"
import PageHeader from "@/components/ui/PageHeader"
import Button from "@/components/ui/Button"

type Material = {
  id: string
  name: string
  unit: string
  quantity_on_hand: number
  default_cost_price: number | null
  average_cost: number
  default_selling_price: number | null
  sales_description: string | null
  sales_notes: string | null
  reorder_level: number
  is_active: boolean
}

export default function ServiceMaterialEditPage() {
  const router = useRouter()
  const params = useParams()
  const id = typeof params?.id === "string" ? params.id : ""
  const [material, setMaterial] = useState<Material | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [warning, setWarning] = useState("")

  const [name, setName] = useState("")
  const [unit, setUnit] = useState("")
  const [description, setDescription] = useState("")
  const [costPrice, setCostPrice] = useState("")
  const [sellingPrice, setSellingPrice] = useState("")
  const [lowStockAlert, setLowStockAlert] = useState("0")
  const [notes, setNotes] = useState("")
  const [isActive, setIsActive] = useState(true)

  useEffect(() => {
    if (!id) { setNotFound(true); setLoading(false); return }
    load()
  }, [id])

  const load = async () => {
    try {
      const res = await fetch(`/api/service/materials/inventory/${id}`)
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 404) setNotFound(true)
        else setError(typeof payload?.error === "string" ? payload.error : "Failed to load")
        setLoading(false)
        return
      }
      const data = payload.material as Material
      setMaterial(data)
      setName(data.name)
      setUnit(data.unit)
      setDescription(data.sales_description ?? "")
      const cp = data.default_cost_price ?? data.average_cost
      setCostPrice(cp != null && cp > 0 ? String(cp) : "")
      setSellingPrice(data.default_selling_price != null ? String(data.default_selling_price) : "")
      setLowStockAlert(String(data.reorder_level ?? 0))
      setNotes(data.sales_notes ?? "")
      setIsActive(data.is_active)
      setLoading(false)
    } catch {
      setError("Failed to load")
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!material) return
    setError("")
    setWarning("")
    setSaving(true)
    try {
      const res = await fetch(`/api/service/materials/inventory/${material.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          unit: unit.trim(),
          description: description.trim() || null,
          cost_price: costPrice.trim() ? parseFloat(costPrice) : null,
          selling_price: sellingPrice.trim() ? parseFloat(sellingPrice) : null,
          low_stock_alert: parseFloat(lowStockAlert) || 0,
          notes: notes.trim() || null,
          is_active: isActive,
        }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "Failed to save")
      if (Array.isArray(payload.warnings) && payload.warnings[0]) setWarning(payload.warnings[0])
      router.push("/service/materials")
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save")
      setSaving(false)
    }
  }

  if (loading) return <LoadingScreen />
  if (notFound || !material) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">Material not found.</p>
        <button onClick={() => router.push("/service/materials")} className="text-blue-600 hover:underline">Back to Materials</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PageHeader title="Edit Material" subtitle={material.name}
          actions={<Button variant="outline" onClick={() => router.push("/service/materials")}>Back</Button>} />
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>}
        {warning && <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded mb-4 text-sm">{warning}</div>}

        <div className="mb-4 p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-600">Quantity available</p>
            <p className="text-xl font-semibold tabular-nums">{Number(material.quantity_on_hand)} {material.unit}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => router.push(`/service/materials/${id}/add-stock`)}>Add stock</Button>
            <Button type="button" variant="outline" onClick={() => router.push(`/service/materials/${id}/use-stock`)}>Use stock</Button>
            <Button type="button" variant="outline" onClick={() => router.push(`/service/materials/${id}/history`)}>Stock history</Button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="bg-white dark:bg-gray-800 border rounded-xl shadow p-6 space-y-4">
            <h2 className="text-sm font-semibold">Material details</h2>
            <div>
              <label className="block text-sm font-medium mb-1">Material name *</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required disabled={saving}
                className="w-full border rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Unit *</label>
              <input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} required disabled={saving}
                className="w-full border rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} disabled={saving}
                className="w-full border rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white" />
              <p className="text-xs text-gray-500 mt-1">Description can be used later when adding this material to customer documents.</p>
            </div>
          </section>

          <section className="bg-white dark:bg-gray-800 border rounded-xl shadow p-6 space-y-4">
            <h2 className="text-sm font-semibold">Prices</h2>
            <p className="text-xs text-gray-500">Cost price is what you buy it for. Selling price is what you charge the customer.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Cost price</label>
                <input type="number" step="0.01" min="0" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} disabled={saving}
                  className="w-full border rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Selling price</label>
                <input type="number" step="0.01" min="0" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} disabled={saving}
                  className="w-full border rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white" />
              </div>
            </div>
          </section>

          <section className="bg-white dark:bg-gray-800 border rounded-xl shadow p-6 space-y-4">
            <h2 className="text-sm font-semibold">Stock settings</h2>
            <div>
              <label className="block text-sm font-medium mb-1">Low stock alert</label>
              <input type="number" step="0.01" min="0" value={lowStockAlert} onChange={(e) => setLowStockAlert(e.target.value)} disabled={saving}
                className="w-full border rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} disabled={saving}
                className="w-full border rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={saving} />
              Active
            </label>
          </section>

          <div className="flex gap-4">
            <Button type="button" variant="outline" onClick={() => router.push("/service/materials")} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save changes"}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
