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
  unit: string
  quantity_on_hand: number
  average_cost: number
}

export default function ServiceMaterialAdjustPage() {
  const router = useRouter()
  const params = useParams()
  const id = typeof params?.id === "string" ? params.id : ""
  const [material, setMaterial] = useState<Material | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState<string | null>(null)

  const [direction, setDirection] = useState<"increase" | "decrease">("increase")
  const [adjustment_amount, setAdjustmentAmount] = useState("")

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
        .select("id, business_id, name, unit, quantity_on_hand, average_cost")
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
      setMaterial(data as Material)
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

    const amount = parseFloat(adjustment_amount)
    if (isNaN(amount) || amount <= 0) {
      setError("Adjustment amount must be a number greater than 0")
      return
    }

    const qty = Number(material.quantity_on_hand ?? 0)
    let new_quantity: number

    if (direction === "increase") {
      new_quantity = qty + amount
    } else {
      if (qty < amount) {
        setError(`Insufficient stock. On hand: ${qty}. Cannot decrease by ${amount}.`)
        return
      }
      new_quantity = qty - amount
    }

    setSaving(true)
    try {
      const { error: uErr } = await supabase
        .from("service_material_inventory")
        .update({ quantity_on_hand: new_quantity })
        .eq("id", material.id)
        .eq("business_id", businessId)
      if (uErr) {
        setError(uErr.message || "Failed to update stock")
        setSaving(false)
        return
      }

      const movementQuantity = direction === "increase" ? amount : -amount
      const { error: mErr } = await supabase.from("service_material_movements").insert({
        business_id: businessId,
        material_id: material.id,
        movement_type: "adjustment",
        quantity: movementQuantity,
        unit_cost: Number(material.average_cost ?? 0),
      })
      if (mErr) {
        setError(mErr.message || "Stock updated but movement log failed")
        setSaving(false)
        return
      }

      setAdjustmentAmount("")
      await load()
      setSaving(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to adjust")
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
              onClick={() => router.push("/service/inventory")}
              className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              Back to Service Inventory
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
          title="Adjust stock"
          subtitle={`${material.name} — current: ${Number(material.quantity_on_hand ?? 0)} ${material.unit}`}
          actions={
            <Button variant="outline" onClick={() => router.push("/service/inventory")}>
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Direction</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="direction"
                  checked={direction === "increase"}
                  onChange={() => setDirection("increase")}
                  disabled={saving}
                  className="rounded border-gray-300"
                />
                <span className="text-gray-900 dark:text-white">Increase stock</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="direction"
                  checked={direction === "decrease"}
                  onChange={() => setDirection("decrease")}
                  disabled={saving}
                  className="rounded border-gray-300"
                />
                <span className="text-gray-900 dark:text-white">Decrease stock</span>
              </label>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Adjustment amount <span className="text-red-600">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={adjustment_amount}
              onChange={(e) => setAdjustmentAmount(e.target.value)}
              required
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
              placeholder="Enter amount"
              disabled={saving}
            />
            {direction === "decrease" && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Current quantity on hand: {Number(material.quantity_on_hand ?? 0)}. You cannot decrease below 0.
              </p>
            )}
          </div>
          <div className="flex gap-4 pt-4">
            <Button type="button" variant="outline" onClick={() => router.push("/service/inventory")} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Applying..." : "Apply adjustment"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
