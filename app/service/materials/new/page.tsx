"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import PageHeader from "@/components/ui/PageHeader"
import Button from "@/components/ui/Button"

export default function ServiceNewMaterialPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [sku, setSku] = useState("")
  const [unit, setUnit] = useState("")
  const [reorder_level, setReorderLevel] = useState("0")
  const [initial_quantity, setInitialQuantity] = useState("0")
  const [is_active, setIsActive] = useState(true)

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const business = await getCurrentBusiness(supabase, user.id)
      if (business) setBusinessId(business.id)
    })()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (!name.trim()) {
      setError("Name is required")
      return
    }
    if (!unit.trim()) {
      setError("Unit is required")
      return
    }
    if (!businessId) {
      setError("Business context not found")
      return
    }
    const reorder = parseFloat(reorder_level)
    if (isNaN(reorder) || reorder < 0) {
      setError("Reorder level must be a non-negative number")
      return
    }
    const initialQty = parseFloat(initial_quantity)
    if (isNaN(initialQty) || initialQty < 0) {
      setError("Initial quantity must be a non-negative number")
      return
    }
    setLoading(true)
    try {
      const { data: inserted, error: insertErr } = await supabase
        .from("service_material_inventory")
        .insert({
          business_id: businessId,
          name: name.trim(),
          sku: sku.trim() || null,
          unit: unit.trim(),
          quantity_on_hand: initialQty,
          average_cost: 0,
          reorder_level: reorder,
          is_active,
        })
        .select("id")
        .single()

      if (insertErr) throw insertErr
      if (!inserted) throw new Error("Failed to create material")

      if (initialQty > 0) {
        await supabase.from("service_material_movements").insert({
          business_id: businessId,
          material_id: inserted.id,
          movement_type: "adjustment",
          quantity: initialQty,
          unit_cost: 0,
          reference_id: null,
        })
      }

      router.push("/service/materials")
    } catch (err: any) {
      setError(err.message || "Failed to create material")
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PageHeader
          title="New Material"
          subtitle="Add a service material to track stock"
          actions={
            <Button variant="outline" onClick={() => router.back()}>
              Back
            </Button>
          }
        />
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Name <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
              placeholder="Material name"
              disabled={loading}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">SKU</label>
            <input
              type="text"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
              placeholder="Optional"
              disabled={loading}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Unit <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              required
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
              placeholder="e.g. kg, L, pcs"
              disabled={loading}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Initial quantity</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={initial_quantity}
              onChange={(e) => setInitialQuantity(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
              disabled={loading}
            />
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
              disabled={loading}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active"
              checked={is_active}
              onChange={(e) => setIsActive(e.target.checked)}
              disabled={loading}
              className="rounded border-gray-300"
            />
            <label htmlFor="is_active" className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Active
            </label>
          </div>
          <div className="flex gap-4 pt-4">
            <Button type="button" variant="outline" onClick={() => router.back()} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Material"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
