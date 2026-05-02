"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { useToast } from "@/components/ui/ToastProvider"

export default function EditAssetPage() {
  const router = useRouter()
  const params = useParams()
  const assetId = params.id as string
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    asset_code: "",
    category: "equipment",
    purchase_date: "",
    purchase_amount: "",
    supplier_name: "",
    useful_life_years: "",
    salvage_value: "",
    notes: "",
  })
  const [currentAccumulatedDep, setCurrentAccumulatedDep] = useState(0)

  // Calculate depreciation values
  const calculateDepreciation = () => {
    const purchaseAmount = Number(formData.purchase_amount) || 0
    const salvageValue = Number(formData.salvage_value) || 0
    const usefulLifeYears = Number(formData.useful_life_years) || 1

    if (usefulLifeYears <= 0 || purchaseAmount <= 0) {
      return {
        monthlyDepreciation: 0,
        annualDepreciation: 0,
        currentValue: purchaseAmount - currentAccumulatedDep,
        accumulatedDepreciation: currentAccumulatedDep,
      }
    }

    const annualDepreciation = (purchaseAmount - salvageValue) / usefulLifeYears
    const monthlyDepreciation = annualDepreciation / 12
    const newCurrentValue = purchaseAmount - currentAccumulatedDep

    return {
      monthlyDepreciation: Math.round(monthlyDepreciation * 100) / 100,
      annualDepreciation: Math.round(annualDepreciation * 100) / 100,
      currentValue: newCurrentValue > salvageValue ? newCurrentValue : salvageValue,
      accumulatedDepreciation: currentAccumulatedDep,
    }
  }

  const depreciationValues = calculateDepreciation()

  useEffect(() => {
    loadAsset()
  }, [assetId])

  const loadAsset = async () => {
    try {
      const response = await fetch(`/api/assets/${assetId}`)
      const data = await response.json()

      if (response.ok && data.asset) {
        const asset = data.asset
        setFormData({
          name: asset.name || "",
          asset_code: asset.asset_code || "",
          category: asset.category || "equipment",
          purchase_date: asset.purchase_date || "",
          purchase_amount: String(asset.purchase_amount || 0),
          supplier_name: asset.supplier_name || "",
          useful_life_years: String(asset.useful_life_years || 5),
          salvage_value: String(asset.salvage_value || 0),
          notes: asset.notes || "",
        })
        setCurrentAccumulatedDep(Number(asset.accumulated_depreciation || 0))
      }
    } catch (error) {
      console.error("Error loading asset:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      const response = await fetch(`/api/assets/${assetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (response.ok) {
        router.push(`/assets/${assetId}/view`)
      } else {
        toast.showToast(data.error || "Error updating asset", "error")
      }
    } catch (error) {
      console.error("Error updating asset:", error)
      toast.showToast("Error updating asset", "error")
    } finally {
      setSaving(false)
    }
  }

  const categories = ["vehicle", "equipment", "furniture", "electronics", "tools", "other"]

  if (loading) {
    return (
      <div className="p-6">
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <button
              onClick={() => router.push(`/assets/${assetId}/view`)}
              className="text-blue-600 dark:text-blue-400 hover:underline mb-2"
            >
              ← Back to Asset
            </button>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Edit fixed asset</h1>
          </div>

          <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Asset Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Asset Code</label>
                <input
                  type="text"
                  value={formData.asset_code}
                  onChange={(e) => setFormData({ ...formData, asset_code: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Category *</label>
                <select
                  required
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Purchase Date *</label>
                <input
                  type="date"
                  required
                  value={formData.purchase_date}
                  onChange={(e) => setFormData({ ...formData, purchase_date: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Purchase Amount (₵) *
                </label>
                <input
                  type="number"
                  required
                  step="0.01"
                  min="0"
                  value={formData.purchase_amount}
                  onChange={(e) => setFormData({ ...formData, purchase_amount: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Useful Life (Years) *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  value={formData.useful_life_years}
                  onChange={(e) => setFormData({ ...formData, useful_life_years: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Salvage Value (₵)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.salvage_value}
                  onChange={(e) => setFormData({ ...formData, salvage_value: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Supplier Name</label>
                <input
                  type="text"
                  value={formData.supplier_name}
                  onChange={(e) => setFormData({ ...formData, supplier_name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              {/* Depreciation Calculation Display */}
              {(formData.purchase_amount && Number(formData.purchase_amount) > 0) && (
                <div className="md:col-span-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-3">
                    Depreciation Calculation
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-blue-700 dark:text-blue-400 mb-1">Monthly Depreciation</p>
                      <p className="text-lg font-bold text-blue-900 dark:text-blue-200">
                        ₵{depreciationValues.monthlyDepreciation.toLocaleString("en-GH", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-blue-700 dark:text-blue-400 mb-1">Annual Depreciation</p>
                      <p className="text-lg font-bold text-blue-900 dark:text-blue-200">
                        ₵{depreciationValues.annualDepreciation.toLocaleString("en-GH", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-blue-700 dark:text-blue-400 mb-1">Current Value</p>
                      <p className="text-lg font-bold text-blue-900 dark:text-blue-200">
                        ₵{depreciationValues.currentValue.toLocaleString("en-GH", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-blue-700 dark:text-blue-400 mb-1">Accumulated Depreciation</p>
                      <p className="text-lg font-bold text-blue-900 dark:text-blue-200">
                        ₵{depreciationValues.accumulatedDepreciation.toLocaleString("en-GH", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-3">
                    * Values update automatically based on purchase amount, salvage value, and useful life. Record monthly depreciation entries to update accumulated depreciation.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 flex gap-4">
              <button
                type="submit"
                disabled={saving}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
              <button
                type="button"
                onClick={() => router.push(`/assets/${assetId}/view`)}
                className="px-6 py-3 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
  )
}


