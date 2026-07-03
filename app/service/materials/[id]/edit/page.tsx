"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import LoadingScreen from "@/components/ui/LoadingScreen"
import PageHeader from "@/components/ui/PageHeader"
import Button from "@/components/ui/Button"

type Material = {
  id: string
  business_id: string
  name: string
  sku: string | null
  unit: string
  average_cost: number
  reorder_level: number
  is_active: boolean
  is_billable: boolean
  sales_name: string | null
  sales_description: string | null
  default_selling_price: number | null
  sales_unit: string | null
  sales_tax_code: string | null
  sales_notes: string | null
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
  const [businessId, setBusinessId] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [sku, setSku] = useState("")
  const [unit, setUnit] = useState("")
  const [average_cost, setAverageCost] = useState("")
  const [reorder_level, setReorderLevel] = useState("")
  const [is_active, setIsActive] = useState(true)
  const [is_billable, setIsBillable] = useState(false)
  const [sales_name, setSalesName] = useState("")
  const [sales_description, setSalesDescription] = useState("")
  const [default_selling_price, setDefaultSellingPrice] = useState("")
  const [sales_unit, setSalesUnit] = useState("")
  const [sales_tax_code, setSalesTaxCode] = useState("")
  const [sales_notes, setSalesNotes] = useState("")

  useEffect(() => {
    if (!id) {
      setNotFound(true)
      setLoading(false)
      return
    }
    load()
  }, [id])

  const load = async () => {
    try {
      setError("")
      const res = await fetch(`/api/service/materials/inventory/${id}`)
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 404) {
          setNotFound(true)
          setLoading(false)
          return
        }
        setError(typeof payload?.error === "string" ? payload.error : "Failed to load material")
        setLoading(false)
        return
      }
      const data = payload.material as Material | undefined
      if (!data) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setBusinessId(data.business_id)
      setMaterial(data)
      setName(data.name)
      setSku(data.sku ?? "")
      setUnit(data.unit)
      setAverageCost(String(data.average_cost ?? 0))
      setReorderLevel(String(data.reorder_level ?? 0))
      setIsActive(data.is_active)
      setIsBillable(data.is_billable ?? false)
      setSalesName(data.sales_name ?? "")
      setSalesDescription(data.sales_description ?? "")
      setDefaultSellingPrice(
        data.default_selling_price != null ? String(data.default_selling_price) : ""
      )
      setSalesUnit(data.sales_unit ?? "")
      setSalesTaxCode(data.sales_tax_code ?? "")
      setSalesNotes(data.sales_notes ?? "")
      setLoading(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load")
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (!businessId || !material) return
    if (!name.trim()) {
      setError("Inventory name is required")
      return
    }
    if (!unit.trim()) {
      setError("Stock unit is required")
      return
    }
    const avgCost = parseFloat(average_cost)
    if (isNaN(avgCost) || avgCost < 0) {
      setError("Average cost must be a non-negative number")
      return
    }
    const reorder = parseFloat(reorder_level)
    if (isNaN(reorder) || reorder < 0) {
      setError("Reorder level must be a non-negative number")
      return
    }
    if (is_billable) {
      const price = parseFloat(default_selling_price)
      if (isNaN(price) || price < 0) {
        setError("Default selling price is required and must be non-negative when billable")
        return
      }
      const resolvedSalesUnit = sales_unit.trim() || unit.trim()
      if (!resolvedSalesUnit) {
        setError("Sales unit is required when billable (or set a stock unit)")
        return
      }
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/service/materials/inventory/${material.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          sku: sku.trim() || null,
          unit: unit.trim(),
          average_cost: avgCost,
          reorder_level: reorder,
          is_active,
          is_billable,
          sales_name: sales_name.trim() || null,
          sales_description: sales_description.trim() || null,
          default_selling_price: is_billable ? parseFloat(default_selling_price) : default_selling_price.trim() ? parseFloat(default_selling_price) : null,
          sales_unit: is_billable ? (sales_unit.trim() || unit.trim()) : sales_unit.trim() || null,
          sales_tax_code: sales_tax_code.trim() || null,
          sales_notes: sales_notes.trim() || null,
        }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof payload?.error === "string" ? payload.error : "Failed to update material")
        setSaving(false)
        return
      }
      router.push("/service/materials")
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update")
      setSaving(false)
    }
  }

  if (loading) return <LoadingScreen />

  if (notFound || (!loading && !material)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-8 text-center">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Material not found</h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              This material does not exist or you do not have access to it.
            </p>
            <button
              onClick={() => router.push("/service/materials")}
              className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              Back to Materials
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!material) return <LoadingScreen />

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PageHeader
          title="Edit Material"
          subtitle="Inventory, cost, and optional billable pricing"
          actions={
            <Button variant="outline" onClick={() => router.push("/service/materials")}>
              Back
            </Button>
          }
        />
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow p-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Inventory &amp; cost</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Stock and supplier cost. Average cost is updated when you post supplier bills.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Inventory name <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
                disabled={saving}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">SKU</label>
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
                disabled={saving}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Stock unit <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                required
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
                disabled={saving}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Average cost</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={average_cost}
                onChange={(e) => setAverageCost(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
                disabled={saving}
              />
              <p className="text-xs text-gray-500 mt-1">Internal inventory cost — not the customer selling price.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reorder level</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={reorder_level}
                onChange={(e) => setReorderLevel(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
                disabled={saving}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={is_active}
                onChange={(e) => setIsActive(e.target.checked)}
                disabled={saving}
                className="rounded border-gray-300"
              />
              <label htmlFor="is_active" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Active
              </label>
            </div>
          </section>

          <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow p-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Billable pricing</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Customer-facing defaults for quotes, proformas, and invoices. Does not affect stock.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_billable"
                checked={is_billable}
                onChange={(e) => setIsBillable(e.target.checked)}
                disabled={saving}
                className="rounded border-gray-300"
              />
              <label htmlFor="is_billable" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Billable on customer documents
              </label>
            </div>
            {is_billable && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Customer-facing name
                  </label>
                  <input
                    type="text"
                    value={sales_name}
                    onChange={(e) => setSalesName(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
                    placeholder={name.trim() || "Defaults to inventory name"}
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Line description
                  </label>
                  <textarea
                    value={sales_description}
                    onChange={(e) => setSalesDescription(e.target.value)}
                    rows={2}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Default selling price <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={default_selling_price}
                    onChange={(e) => setDefaultSellingPrice(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sales unit</label>
                  <input
                    type="text"
                    value={sales_unit}
                    onChange={(e) => setSalesUnit(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
                    placeholder={unit.trim() || "Defaults to stock unit"}
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tax code</label>
                  <input
                    type="text"
                    value={sales_tax_code}
                    onChange={(e) => setSalesTaxCode(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pricing notes</label>
                  <textarea
                    value={sales_notes}
                    onChange={(e) => setSalesNotes(e.target.value)}
                    rows={2}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
                    disabled={saving}
                  />
                </div>
              </>
            )}
          </section>

          <div className="flex gap-4">
            <Button type="button" variant="outline" onClick={() => router.push("/service/materials")} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
