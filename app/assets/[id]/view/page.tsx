"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { useToast } from "@/components/ui/ToastProvider"
import { useServiceFinancialWrite } from "@/components/service/useServiceFinancialWrite"
import ServiceReadOnlyNotice from "@/components/service/ServiceReadOnlyNotice"
import {
  calculateMonthlyDepreciation,
  normalizeDepreciationPostingDate,
  remainingDepreciableAmount,
  resolvePostingAmount,
} from "@/lib/assets/depreciationAmount"

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
  status?: string
  journal_entry_id?: string | null
  adjustment_reason?: string | null
  reverses_entry_id?: string | null
  reversed_by_entry_id?: string | null
}

function statusBadgeClass(status: string | undefined): string {
  switch (status) {
    case "posted":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
    case "adjusted":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
    case "reversed":
      return "bg-gray-100 text-gray-500 line-through dark:bg-gray-700 dark:text-gray-400"
    case "reversal":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
  }
}

export default function AssetViewPage() {
  const router = useRouter()
  const params = useParams()
  const assetId = params.id as string
  const toast = useToast()
  const { readOnly } = useServiceFinancialWrite("accounting")
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)
  const [reversing, setReversing] = useState(false)
  const [asset, setAsset] = useState<Asset | null>(null)
  const [depreciationEntries, setDepreciationEntries] = useState<DepreciationEntry[]>([])
  const [showDepreciationModal, setShowDepreciationModal] = useState(false)
  const [showReverseModal, setShowReverseModal] = useState(false)
  const [reverseTarget, setReverseTarget] = useState<DepreciationEntry | null>(null)
  const [showDisposalModal, setShowDisposalModal] = useState(false)
  const [depreciationDate, setDepreciationDate] = useState(new Date().toISOString().split("T")[0])
  const [postAmount, setPostAmount] = useState<string>("")
  const [adjustmentReason, setAdjustmentReason] = useState("")
  const [useCustomAmount, setUseCustomAmount] = useState(false)
  const [reversalDate, setReversalDate] = useState(new Date().toISOString().split("T")[0])
  const [reversalReason, setReversalReason] = useState("")
  const [disposalData, setDisposalData] = useState({
    disposal_date: new Date().toISOString().split("T")[0],
    disposal_amount: "",
    disposal_buyer: "",
    disposal_notes: "",
  })

  useEffect(() => {
    loadAsset()
  }, [assetId])

  const postedAccumFromEntries = useMemo(() => {
    return depreciationEntries
      .filter((e) => e.status === "posted" || e.status === "adjusted" || (!e.status && !e.reverses_entry_id))
      .reduce((sum, e) => sum + Number(e.amount), 0)
  }, [depreciationEntries])

  const preview = useMemo(() => {
    if (!asset) return null
    const purchase = Number(asset.purchase_amount)
    const salvage = Number(asset.salvage_value)
    const life = Number(asset.useful_life_years)
    const postedAccum = postedAccumFromEntries
    const remaining = remainingDepreciableAmount(purchase, salvage, postedAccum)
    const expected = calculateMonthlyDepreciation(purchase, salvage, life)
    const resolved = resolvePostingAmount(
      purchase,
      salvage,
      life,
      postedAccum,
      useCustomAmount && postAmount ? Number(postAmount) : null
    )
    const carryingBefore = Number(asset.current_value)
    const carryingAfter = Math.max(salvage, carryingBefore - resolved.amount)
    return { remaining, expected, resolved, carryingBefore, carryingAfter }
  }, [asset, postedAccumFromEntries, useCustomAmount, postAmount])

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

  const handlePostDepreciation = async () => {
    if (!asset || !preview) return

    if (preview.resolved.isAdjusted && !adjustmentReason.trim()) {
      toast.showToast("Adjustment reason is required when amount differs from calculated depreciation.", "warning")
      return
    }

    if (preview.resolved.amount <= 0) {
      toast.showToast("No depreciable amount remaining for this asset.", "warning")
      return
    }

    try {
      setPosting(true)
      const idempotencyKey =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `dep-${Date.now()}`

      const body: Record<string, unknown> = {
        date: depreciationDate,
        idempotency_key: idempotencyKey,
      }
      if (useCustomAmount) {
        body.amount = preview.resolved.amount
        if (preview.resolved.isAdjusted) {
          body.adjustment_reason = adjustmentReason.trim()
        }
      }

      const response = await fetch(`/api/assets/${assetId}/depreciation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (response.ok) {
        setShowDepreciationModal(false)
        setDepreciationDate(new Date().toISOString().split("T")[0])
        setPostAmount("")
        setAdjustmentReason("")
        setUseCustomAmount(false)
        toast.showToast(
          data.idempotent
            ? "Depreciation already posted (idempotent retry)."
            : `Depreciation posted. Journal ${data.journal_entry_id?.slice(0, 8) ?? ""}…`,
          "success"
        )
        loadAsset()
      } else {
        if (data.code === "DUPLICATE_POSTING") {
          toast.showToast("Depreciation already posted for this month.", "warning")
          return
        }
        toast.showToast(data.error || "Error posting depreciation.", "error")
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Please check your connection and try again."
      toast.showToast(`Error posting depreciation: ${message}`, "error")
    } finally {
      setPosting(false)
    }
  }

  const handleReverseDepreciation = async () => {
    if (!reverseTarget) return
    if (!reversalReason.trim()) {
      toast.showToast("Reversal reason is required.", "warning")
      return
    }

    try {
      setReversing(true)
      const response = await fetch(`/api/assets/${assetId}/depreciation/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          depreciation_entry_id: reverseTarget.id,
          reversal_date: reversalDate,
          reason: reversalReason.trim(),
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setShowReverseModal(false)
        setReverseTarget(null)
        setReversalReason("")
        toast.showToast("Depreciation reversed successfully.", "success")
        loadAsset()
      } else {
        toast.showToast(data.error || "Error reversing depreciation.", "error")
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Please try again."
      toast.showToast(`Error reversing depreciation: ${message}`, "error")
    } finally {
      setReversing(false)
    }
  }

  const openReverseModal = (entry: DepreciationEntry) => {
    setReverseTarget(entry)
    setReversalDate(new Date().toISOString().split("T")[0])
    setReversalReason("")
    setShowReverseModal(true)
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
        toast.showToast(data.error || "Error disposing asset. Please try again.", "error")
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Please check your connection and try again."
      toast.showToast(`Error disposing asset: ${message}`, "error")
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <p>Loading...</p>
      </div>
    )
  }

  if (!asset) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 border border-gray-200 dark:border-gray-700 text-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Fixed asset not found</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              This fixed asset could not be loaded. Please refresh or return to the list.
            </p>
            <div className="flex gap-4 justify-center">
              <button
                onClick={() => router.push("/assets")}
                className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium"
              >
                Back to Fixed Assets
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
    )
  }

  const annualDepreciation =
    (Number(asset.purchase_amount) - Number(asset.salvage_value)) / Number(asset.useful_life_years)
  const monthlyDepreciation = annualDepreciation / 12

  return (
    <>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <button
                onClick={() => router.push("/assets")}
                className="text-blue-600 dark:text-blue-400 hover:underline mb-2"
              >
                ← Back to Fixed Assets
              </button>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">{asset.name}</h1>
              <p className="text-gray-600 dark:text-gray-400">
                {asset.asset_code || "N/A"} • {asset.category.charAt(0).toUpperCase() + asset.category.slice(1)}
              </p>
            </div>
            <div className="flex gap-3">
              {!readOnly && asset.status === "active" && (
                <>
                  <button
                    onClick={() => setShowDepreciationModal(true)}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                  >
                    Post depreciation
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
                    Dispose fixed asset
                  </button>
                </>
              )}
            </div>
          </div>

          {readOnly && <ServiceReadOnlyNotice scope="accounting" className="mb-6" />}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Fixed asset details</h2>
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

              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Depreciation History</h2>
                {depreciationEntries.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400">No depreciation posted yet</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Date</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Amount</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Journal</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Actions</th>
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
                            <td className="px-4 py-2 text-sm">
                              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusBadgeClass(entry.status)}`}>
                                {entry.status || "posted"}
                              </span>
                              {entry.adjustment_reason && (
                                <p className="text-xs text-gray-500 mt-1">{entry.adjustment_reason}</p>
                              )}
                            </td>
                            <td className="px-4 py-2 text-xs font-mono text-gray-600 dark:text-gray-400">
                              {entry.journal_entry_id ? entry.journal_entry_id.slice(0, 8) + "…" : "—"}
                            </td>
                            <td className="px-4 py-2 text-sm text-right">
                              {!readOnly &&
                                (entry.status === "posted" || entry.status === "adjusted") &&
                                !entry.reversed_by_entry_id && (
                                  <button
                                    type="button"
                                    onClick={() => openReverseModal(entry)}
                                    className="text-red-600 hover:underline dark:text-red-400"
                                  >
                                    Reverse
                                  </button>
                                )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

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
                    <p className="text-sm text-gray-500 dark:text-gray-400">Calculated monthly amount</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">₵{monthlyDepreciation.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Annual Depreciation</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">₵{annualDepreciation.toFixed(2)}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showDepreciationModal && preview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Post depreciation</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{asset.name}</p>

            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Posting date *</label>
                <input
                  type="date"
                  value={depreciationDate}
                  onChange={(e) => setDepreciationDate(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Normalized to {normalizeDepreciationPostingDate(depreciationDate)} (first of month).
                </p>
              </div>

              <div className="rounded-lg bg-gray-50 dark:bg-gray-900 p-4 text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">Calculated monthly amount</span>
                  <span className="font-medium">₵{preview.expected.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Remaining depreciable</span>
                  <span className="font-medium">₵{preview.remaining.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Carrying value before</span>
                  <span className="font-medium">₵{preview.carryingBefore.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Carrying value after</span>
                  <span className="font-medium text-green-600">₵{preview.carryingAfter.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Amount to post</span>
                  <span className="font-bold">₵{preview.resolved.amount.toFixed(2)}</span>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={useCustomAmount}
                  onChange={(e) => setUseCustomAmount(e.target.checked)}
                />
                Use adjusted amount
              </label>

              {useCustomAmount && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Adjusted amount (₵)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={postAmount}
                      onChange={(e) => setPostAmount(e.target.value)}
                      placeholder={preview.expected.toFixed(2)}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                  {preview.resolved.isAdjusted && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Adjustment reason *
                      </label>
                      <textarea
                        value={adjustmentReason}
                        onChange={(e) => setAdjustmentReason(e.target.value)}
                        rows={2}
                        className="w-full px-4 py-2 border border-amber-400 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        placeholder="Explain why this amount differs from calculated depreciation"
                      />
                    </div>
                  )}
                </>
              )}

              <div className="rounded border border-gray-200 dark:border-gray-600 p-3 text-xs text-gray-600 dark:text-gray-400">
                <p className="font-medium text-gray-800 dark:text-gray-200 mb-1">Journal preview</p>
                <p>DR Depreciation Expense (5700) ₵{preview.resolved.amount.toFixed(2)}</p>
                <p>CR Accumulated Depreciation (1650) ₵{preview.resolved.amount.toFixed(2)}</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handlePostDepreciation}
                disabled={posting || preview.resolved.amount <= 0}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {posting ? "Posting…" : "Confirm post"}
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

      {showReverseModal && reverseTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Reverse depreciation</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Reverse ₵{Number(reverseTarget.amount).toFixed(2)} posted on{" "}
              {new Date(reverseTarget.date).toLocaleDateString()}
            </p>
            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Reversal date *</label>
                <input
                  type="date"
                  value={reversalDate}
                  onChange={(e) => setReversalDate(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Reason *</label>
                <textarea
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleReverseDepreciation}
                disabled={reversing}
                className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {reversing ? "Reversing…" : "Confirm reverse"}
              </button>
              <button
                onClick={() => {
                  setShowReverseModal(false)
                  setReverseTarget(null)
                }}
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showDisposalModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Dispose fixed asset</h3>
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Disposal Amount (₵) *</label>
                <input
                  type="number"
                  required
                  step="0.01"
                  value={disposalData.disposal_amount}
                  onChange={(e) => setDisposalData({ ...disposalData, disposal_amount: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={handleDisposeAsset} className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700">
                Dispose fixed asset
              </button>
              <button
                onClick={() => setShowDisposalModal(false)}
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
