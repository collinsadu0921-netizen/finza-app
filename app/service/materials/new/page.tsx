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
  const [name, setName] = useState("")
  const [sku, setSku] = useState("")
  const [unit, setUnit] = useState("")
  const [reorder_level, setReorderLevel] = useState("0")
  const [initial_quantity, setInitialQuantity] = useState("0")
  const [is_active, setIsActive] = useState(true)
  const [is_billable, setIsBillable] = useState(false)
  const [sales_name, setSalesName] = useState("")
  const [sales_description, setSalesDescription] = useState("")
  const [default_selling_price, setDefaultSellingPrice] = useState("")
  const [sales_unit, setSalesUnit] = useState("")
  const [sales_tax_code, setSalesTaxCode] = useState("")
  const [sales_notes, setSalesNotes] = useState("")

  useEffect(() => {
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const business = await getCurrentBusiness(supabase, user.id)
      if (business) setBusinessId(business.id)
    })()
  }, [])

  useSyncServiceBusinessIdInUrl(businessId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (!name.trim()) {
      setError("Inventory name is required")
      return
    }
    if (!unit.trim()) {
      setError("Stock unit is required")
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
    setLoading(true)
    try {
      const res = await fetch("/api/service/materials/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          sku: sku.trim() || null,
          unit: unit.trim(),
          reorder_level: reorder,
          initial_quantity: initialQty,
          is_active,
          is_billable,
          sales_name: sales_name.trim() || null,
          sales_description: sales_description.trim() || null,
          default_selling_price: is_billable ? parseFloat(default_selling_price) : null,
          sales_unit: is_billable ? (sales_unit.trim() || unit.trim()) : sales_unit.trim() || null,
          sales_tax_code: sales_tax_code.trim() || null,
          sales_notes: sales_notes.trim() || null,
        }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "Failed to create material")
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
          subtitle="Track inventory and cost; optionally set customer pricing for quotes and invoices"
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
        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow p-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Inventory &amp; cost</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Internal stock tracking. Average cost comes from supplier bills, not customer price.
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
                placeholder="e.g. 12mm copper pipe"
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
                Stock unit <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                required
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
                placeholder="e.g. kg, L, pcs, m"
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
          </section>

          <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow p-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Billable pricing</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Optional customer-facing price for quotes, proformas, and invoices. Does not change stock.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_billable"
                checked={is_billable}
                onChange={(e) => setIsBillable(e.target.checked)}
                disabled={loading}
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
                    disabled={loading}
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
                    placeholder="Shown on quotes and invoices when this material is selected"
                    disabled={loading}
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
                    placeholder="Customer unit price (not average cost)"
                    disabled={loading}
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
                    disabled={loading}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tax code</label>
                  <input
                    type="text"
                    value={sales_tax_code}
                    onChange={(e) => setSalesTaxCode(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
                    placeholder="Optional"
                    disabled={loading}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pricing notes</label>
                  <textarea
                    value={sales_notes}
                    onChange={(e) => setSalesNotes(e.target.value)}
                    rows={2}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
                    placeholder="Internal notes (not printed on documents)"
                    disabled={loading}
                  />
                </div>
              </>
            )}
          </section>

          <div className="flex gap-4">
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
