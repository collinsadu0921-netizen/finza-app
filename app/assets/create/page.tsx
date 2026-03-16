"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { useToast } from "@/components/ui/ToastProvider"

export default function CreateAssetPage() {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [accounts, setAccounts] = useState<any[]>([])
  const [formData, setFormData] = useState({
    name: "",
    asset_code: "",
    category: "equipment",
    purchase_date: new Date().toISOString().split("T")[0],
    purchase_amount: "",
    supplier_name: "",
    useful_life_years: "5",
    salvage_value: "0",
    payment_account_id: "",
    notes: "",
  })

  // Calculate depreciation values
  const calculateDepreciation = () => {
    const purchaseAmount = Number(formData.purchase_amount) || 0
    const salvageValue = Number(formData.salvage_value) || 0
    const usefulLifeYears = Number(formData.useful_life_years) || 1

    if (usefulLifeYears <= 0 || purchaseAmount <= 0) {
      return {
        monthlyDepreciation: 0,
        annualDepreciation: 0,
        currentValue: purchaseAmount,
        accumulatedDepreciation: 0,
      }
    }

    const annualDepreciation = (purchaseAmount - salvageValue) / usefulLifeYears
    const monthlyDepreciation = annualDepreciation / 12

    return {
      monthlyDepreciation: Math.round(monthlyDepreciation * 100) / 100,
      annualDepreciation: Math.round(annualDepreciation * 100) / 100,
      currentValue: purchaseAmount, // Starts at purchase amount, decreases with depreciation
      accumulatedDepreciation: 0, // Starts at 0
    }
  }

  const depreciationValues = calculateDepreciation()

  useEffect(() => {
    loadAccounts()
  }, [])

  const loadAccounts = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) return

      const response = await fetch("/api/accounts/list")
      const data = await response.json()
      if (response.ok) {
        const assetAccounts = (data.accounts || []).filter(
          (acc: any) => acc.type === "asset" && ["1010", "1020", "1000"].includes(acc.code)
        )
        setAccounts(assetAccounts)
        if (assetAccounts.length > 0) {
          setFormData({ ...formData, payment_account_id: assetAccounts[0].id })
        }
      }
    } catch (error) {
      console.error("Error loading accounts:", error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await fetch("/api/assets/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (response.ok && data.asset && data.asset.id) {
        // Use assetId from response or fallback to asset.id
        const assetId = data.assetId || data.asset.id
        router.push(`/assets/${assetId}`)
      } else {
        toast.showToast(data.error || "Error creating asset", "error")
      }
    } catch (error) {
      console.error("Error creating asset:", error)
      toast.showToast("Error creating asset", "error")
    } finally {
      setLoading(false)
    }
  }

  const categories = ["vehicle", "equipment", "furniture", "electronics", "tools", "other"]

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Add New Asset</h1>
            <p className="text-gray-600 dark:text-gray-400">Record a fixed asset purchase</p>
          </div>

          <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Asset Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Asset Code (auto-generated if empty)
                </label>
                <input
                  type="text"
                  value={formData.asset_code}
                  onChange={(e) => setFormData({ ...formData, asset_code: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Category *
                </label>
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Purchase Date *
                </label>
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Salvage Value (₵)
                </label>
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Payment Account
                </label>
                <select
                  value={formData.payment_account_id}
                  onChange={(e) => setFormData({ ...formData, payment_account_id: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Supplier Name
                </label>
                <input
                  type="text"
                  value={formData.supplier_name}
                  onChange={(e) => setFormData({ ...formData, supplier_name: e.target.value })}
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
                      <p className="text-xs text-blue-700 dark:text-blue-400 mb-1">Initial Current Value</p>
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
                    * Depreciation will be calculated automatically based on these values. Record monthly depreciation entries to update accumulated depreciation.
                  </p>
                </div>
              )}

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-4">
              <button
                type="submit"
                disabled={loading}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
              >
                {loading ? "Creating..." : "Create Asset"}
              </button>
              <button
                type="button"
                onClick={() => router.back()}
                className="px-6 py-3 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </ProtectedLayout>
  )
}


