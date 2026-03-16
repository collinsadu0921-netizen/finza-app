"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { useToast } from "@/components/ui/ToastProvider"

type Asset = {
  id: string
  name: string
  asset_code: string | null
  category: string
  purchase_date: string
  purchase_amount: number
  supplier_name: string | null
  useful_life_years: number
  salvage_value: number
  current_value: number
  accumulated_depreciation: number
  status: string
  disposal_date: string | null
  disposal_amount: number | null
  notes: string | null
}

type DepreciationEntry = {
  id: string
  date: string
  amount: number
}

export default function AssetViewPage() {
  const router = useRouter()
  const params = useParams()
  const assetId = params.id as string
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [asset, setAsset] = useState<Asset | null>(null)
  const [depreciationEntries, setDepreciationEntries] = useState<DepreciationEntry[]>([])
  const [showDepreciationModal, setShowDepreciationModal] = useState(false)
  const [showDisposalModal, setShowDisposalModal] = useState(false)
  const [depreciationDate, setDepreciationDate] = useState(new Date().toISOString().split("T")[0])
  const [disposalData, setDisposalData] = useState({
    disposal_date: new Date().toISOString().split("T")[0],
    disposal_amount: "",
    disposal_buyer: "",
    disposal_notes: "",
  })

  useEffect(() => {
    loadAsset()
  }, [assetId])

  const loadAsset = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/assets/${assetId}`)
      const data = await response.json()

      if (response.ok && data.asset) {
        setAsset(data.asset)
        setDepreciationEntries(data.depreciationEntries || [])
      } else {
        console.error("Error loading asset:", data.error || "Unknown error")
        setAsset(null)
      }
    } catch (error) {
      console.error("Error loading asset:", error)
      setAsset(null)
    } finally {
      setLoading(false)
    }
  }

  const handleRecordDepreciation = async () => {
    try {
      const response = await fetch(`/api/assets/${assetId}/depreciation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: depreciationDate }),
      })

      const data = await response.json()

      if (response.ok) {
        setShowDepreciationModal(false)
        setDepreciationDate(new Date().toISOString().split("T")[0]) // Reset date
        loadAsset()
      } else {
        console.error("Error recording depreciation:", data.error)
        // Show user-friendly error message
        let errorMessage = data.error || "Error recording depreciation. Please try again."
        
        // If depreciation already exists, provide helpful guidance
        if (data.error && data.error.includes("already recorded")) {
          toast.showToast("Depreciation already recorded for this month.", "warning")
          return
        }
        toast.showToast(errorMessage, "error")
      }
    } catch (error: any) {
      console.error("Error recording depreciation:", error)
      toast.showToast(`Error recording depreciation: ${error.message || "Please check your connection and try again."}`, "error")
    }
  }

  const handleDisposeAsset = async () => {
    if (!disposalData.disposal_amount) {
      toast.showToast("Please enter disposal amount", "warning")
      return
    }

    try {
      const response = await fetch(`/api/assets/${assetId}/dispose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(disposalData),
      })

      const data = await response.json()

      if (response.ok) {
        setShowDisposalModal(false)
        loadAsset()
      } else {
        console.error("Error disposing asset:", data.error)
        toast.showToast(data.error || "Error disposing asset. Please try again.", "error")
      }
    } catch (error: any) {
      console.error("Error disposing asset:", error)
      toast.showToast(`Error disposing asset: ${error.message || "Please check your connection and try again."}`, "error")
    }
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </ProtectedLayout>
    )
  }

  if (!asset) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
          <div className="max-w-4xl mx-auto">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 border border-gray-200 dark:border-gray-700 text-center">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                Asset Not Found
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Asset could not be loaded. Please refresh or return to the list.
              </p>
              <div className="flex gap-4 justify-center">
                <button
                  onClick={() => router.push("/assets")}
                  className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium"
                >
                  Back to All Assets
                </button>
                <button
                  onClick={() => loadAsset()}
                  className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-6 py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  const annualDepreciation = (Number(asset.purchase_amount) - Number(asset.salvage_value)) / Number(asset.useful_life_years)
  const monthlyDepreciation = annualDepreciation / 12

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <button
                onClick={() => router.push("/assets")}
                className="text-blue-600 dark:text-blue-400 hover:underline mb-2"
              >
                ← Back to Assets
              </button>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">{asset.name}</h1>
              <p className="text-gray-600 dark:text-gray-400">
                {asset.asset_code || "N/A"} • {asset.category.charAt(0).toUpperCase() + asset.category.slice(1)}
              </p>
            </div>
            <div className="flex gap-3">
              {asset.status === "active" && (
                <>
                  <button
                    onClick={() => setShowDepreciationModal(true)}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                  >
                    Record Depreciation
                  </button>
                  <button
                    onClick={() => router.push(`/assets/${assetId}/edit`)}
                    className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setShowDisposalModal(true)}
                    className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
                  >
                    Dispose Asset
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Asset Details */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Asset Details</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Purchase Date</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      {new Date(asset.purchase_date).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Purchase Amount</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      ₵{Number(asset.purchase_amount).toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Useful Life</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">{asset.useful_life_years} years</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Salvage Value</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      ₵{Number(asset.salvage_value).toFixed(2)}
                    </p>
                  </div>
                  {asset.supplier_name && (
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Supplier</p>
                      <p className="text-lg font-semibold text-gray-900 dark:text-white">{asset.supplier_name}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Status</p>
                    <span
                      className={`px-3 py-1 text-sm font-semibold rounded-full ${
                        asset.status === "active"
                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
                      }`}
                    >
                      {asset.status}
                    </span>
                  </div>
                </div>
                {asset.notes && (
                  <div className="mt-4">
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Notes</p>
                    <p className="text-gray-900 dark:text-white">{asset.notes}</p>
                  </div>
                )}
              </div>

              {/* Depreciation History */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Depreciation History</h2>
                {depreciationEntries.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400">No depreciation recorded yet</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                            Date
                          </th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {depreciationEntries.map((entry) => (
                          <tr key={entry.id}>
                            <td className="px-4 py-2 text-sm text-gray-900 dark:text-white">
                              {new Date(entry.date).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-2 text-sm text-right text-gray-900 dark:text-white">
                              ₵{Number(entry.amount).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Valuation Summary */}
            <div className="space-y-6">
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Valuation Summary</h2>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Purchase Amount</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      ₵{Number(asset.purchase_amount).toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Accumulated Depreciation</p>
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                      -₵{Number(asset.accumulated_depreciation || 0).toFixed(2)}
                    </p>
                  </div>
                  <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-sm text-gray-500 dark:text-gray-400">Current Value (Net Book Value)</p>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                      ₵{Number(asset.current_value || 0).toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Depreciation Schedule</h2>
                <div className="space-y-2">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Annual Depreciation</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      ₵{annualDepreciation.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Monthly Depreciation</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      ₵{monthlyDepreciation.toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Depreciation Modal */}
      {showDepreciationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Record Depreciation</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Depreciation Date *
              </label>
              <input
                type="date"
                value={depreciationDate}
                onChange={(e) => setDepreciationDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                required
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Note: Only one depreciation entry is allowed per month. Select the first day of the month you want to record depreciation for (e.g., 2024-01-01 for January 2024).
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleRecordDepreciation}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                Record
              </button>
              <button
                onClick={() => setShowDepreciationModal(false)}
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disposal Modal */}
      {showDisposalModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Dispose Asset</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Disposal Date *</label>
                <input
                  type="date"
                  required
                  value={disposalData.disposal_date}
                  onChange={(e) => setDisposalData({ ...disposalData, disposal_date: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Disposal Amount (₵) *
                </label>
                <input
                  type="number"
                  required
                  step="0.01"
                  value={disposalData.disposal_amount}
                  onChange={(e) => setDisposalData({ ...disposalData, disposal_amount: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Buyer</label>
                <input
                  type="text"
                  value={disposalData.disposal_buyer}
                  onChange={(e) => setDisposalData({ ...disposalData, disposal_buyer: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Notes</label>
                <textarea
                  value={disposalData.disposal_notes}
                  onChange={(e) => setDisposalData({ ...disposalData, disposal_notes: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleDisposeAsset}
                className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
              >
                Dispose Asset
              </button>
              <button
                onClick={() => setShowDisposalModal(false)}
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </ProtectedLayout>
  )
}


