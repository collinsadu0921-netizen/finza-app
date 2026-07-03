"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { useSyncServiceBusinessIdInUrl } from "@/lib/navigation/serviceBusinessUrl"
import PageHeader from "@/components/ui/PageHeader"
import Button from "@/components/ui/Button"

export default function ServiceNewMaterialPage() {
  const router = useRouter()
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [warning, setWarning] = useState("")

  const [name, setName] = useState("")
  const [unit, setUnit] = useState("")
  const [description, setDescription] = useState("")
  const [costPrice, setCostPrice] = useState("")
  const [sellingPrice, setSellingPrice] = useState("")
  const [quantity, setQuantity] = useState("0")
  const [lowStockAlert, setLowStockAlert] = useState("0")
  const [notes, setNotes] = useState("")

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const business = await getCurrentBusiness(supabase, user.id)
      if (business) setBusinessId(business.id)
    })()
  }, [])

  useSyncServiceBusinessIdInUrl(businessId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setWarning("")
    setLoading(true)
    try {
      const res = await fetch("/api/service/materials/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          unit: unit.trim(),
          description: description.trim() || null,
          cost_price: costPrice.trim() ? parseFloat(costPrice) : null,
          selling_price: sellingPrice.trim() ? parseFloat(sellingPrice) : null,
          quantity_available: parseFloat(quantity) || 0,
          low_stock_alert: parseFloat(lowStockAlert) || 0,
          notes: notes.trim() || null,
        }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "Failed to save material")
      }
      if (Array.isArray(payload.warnings) && payload.warnings[0]) {
        setWarning(payload.warnings[0])
      }
      router.push("/service/materials")
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save material")
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PageHeader
          title="New Material"
          subtitle="Save a material your business uses"
          actions={<Button variant="outline" onClick={() => router.back()}>Back</Button>}
        />
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>}
        {warning && <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded mb-4 text-sm">{warning}</div>}

        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Material details</h2>
            <div>
              <label className="block text-sm font-medium mb-1">Material name <span className="text-red-600">*</span></label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required disabled={loading}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Unit <span className="text-red-600">*</span></label>
              <input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} required placeholder="e.g. bucket, cylinder, m" disabled={loading}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} disabled={loading}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white" />
              <p className="text-xs text-gray-500 mt-1">Description can be used later when adding this material to customer documents.</p>
            </div>
          </section>

          <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Prices</h2>
            <p className="text-xs text-gray-500">Cost price is what you buy it for. Selling price is what you charge the customer.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Cost price</label>
                <input type="number" step="0.01" min="0" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} disabled={loading}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Selling price</label>
                <input type="number" step="0.01" min="0" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} disabled={loading}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white" />
              </div>
            </div>
          </section>

          <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Stock</h2>
            <p className="text-xs text-gray-500">Leave quantity as 0 if you only want to save the material price.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Quantity available</label>
                <input type="number" step="0.01" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} disabled={loading}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Low stock alert</label>
                <input type="number" step="0.01" min="0" value={lowStockAlert} onChange={(e) => setLowStockAlert(e.target.value)} disabled={loading}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} disabled={loading}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white" />
            </div>
          </section>

          <div className="flex gap-4">
            <Button type="button" variant="outline" onClick={() => router.back()} disabled={loading}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Saving..." : "Save Material"}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
