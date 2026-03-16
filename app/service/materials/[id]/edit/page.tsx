"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
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
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setLoading(false)
        return
      }
      setBusinessId(business.id)
      const { data, error: qErr } = await supabase
        .from("service_material_inventory")
        .select("id, business_id, name, sku, unit, average_cost, reorder_level, is_active")
        .eq("id", id)
        .eq("business_id", business.id)
        .maybeSingle()
      if (qErr) {
        setError(qErr.message || "Failed to load material")
        setLoading(false)
        return
      }
      if (!data) {
        setNotFound(true)
        setLoading(false)
        return
      }
      const row = data as Material
      setMaterial(row)
      setName(row.name)
      setSku(row.sku ?? "")
      setUnit(row.unit)
      setAverageCost(String(row.average_cost ?? 0))
      setReorderLevel(String(row.reorder_level ?? 0))
      setIsActive(row.is_active)
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
      setError("Name is required")
      return
    }
    if (!unit.trim()) {
      setError("Unit is required")
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
    setSaving(true)
    try {
      const { error: uErr } = await supabase
        .from("service_material_inventory")
        .update({
          name: name.trim(),
          sku: sku.trim() || null,
          unit: unit.trim(),
          average_cost: avgCost,
          reorder_level: reorder,
          is_active,
        })
        .eq("id", material.id)
        .eq("business_id", businessId)
      if (uErr) {
        setError(uErr.message || "Failed to update material")
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PageHeader
          title="Edit Material"
          subtitle={material.name}
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
              placeholder="Optional"
              disabled={saving}
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
          <div className="flex gap-4 pt-4">
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
