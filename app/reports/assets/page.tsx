"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"

type AssetSummary = {
  totalCost: number
  totalDepreciation: number
  totalNetValue: number
  assetCount: number
  activeCount: number
  disposedCount: number
}

export default function AssetReportsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<AssetSummary>({
    totalCost: 0,
    totalDepreciation: 0,
    totalNetValue: 0,
    assetCount: 0,
    activeCount: 0,
    disposedCount: 0,
  })
  const [assets, setAssets] = useState<any[]>([])

  useEffect(() => {
    loadReport()
  }, [])

  const loadReport = async () => {
    try {
      const response = await fetch("/api/assets/list")
      const data = await response.json()

      if (response.ok) {
        const assetList = data.assets || []
        setAssets(assetList)

        const totalCost = assetList.reduce((sum: number, a: any) => sum + Number(a.purchase_amount || 0), 0)
        const totalDepreciation = assetList.reduce(
          (sum: number, a: any) => sum + Number(a.accumulated_depreciation || 0),
          0
        )
        const totalNetValue = assetList.reduce((sum: number, a: any) => sum + Number(a.current_value || 0), 0)
        const activeCount = assetList.filter((a: any) => a.status === "active").length
        const disposedCount = assetList.filter((a: any) => a.status === "disposed").length

        setSummary({
          totalCost,
          totalDepreciation,
          totalNetValue,
          assetCount: assetList.length,
          activeCount,
          disposedCount,
        })
      }
    } catch (error) {
      console.error("Error loading asset report:", error)
    } finally {
      setLoading(false)
    }
  }

  const exportCSV = () => {
    const headers = ["Asset Code", "Name", "Category", "Purchase Date", "Purchase Amount", "Current Value", "Depreciation", "Status"]
    const rows = assets.map((a) => [
      a.asset_code || "N/A",
      a.name,
      a.category,
      new Date(a.purchase_date).toLocaleDateString(),
      Number(a.purchase_amount).toFixed(2),
      Number(a.current_value || 0).toFixed(2),
      Number(a.accumulated_depreciation || 0).toFixed(2),
      a.status,
    ])

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `assets-report-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
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

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Asset Reports</h1>
              <p className="text-gray-600 dark:text-gray-400">Summary of all fixed assets</p>
            </div>
            <button
              onClick={exportCSV}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
            >
              Export CSV
            </button>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-2">Total Cost</h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">
                ₵{summary.totalCost.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-2">Accumulated Depreciation</h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">
                ₵{summary.totalDepreciation.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-2">Net Book Value</h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">
                ₵{summary.totalNetValue.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {/* Asset Counts */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-2">Total Assets</h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">{summary.assetCount}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-2">Active Assets</h3>
              <p className="text-3xl font-bold text-green-600 dark:text-green-400">{summary.activeCount}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-2">Disposed Assets</h3>
              <p className="text-3xl font-bold text-gray-600 dark:text-gray-400">{summary.disposedCount}</p>
            </div>
          </div>

          {/* Assets Table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                      Asset Code
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                      Category
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                      Purchase Amount
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                      Current Value
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                      Depreciation
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {assets.map((asset) => (
                    <tr key={asset.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                        {asset.asset_code || "N/A"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{asset.name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                        {asset.category.charAt(0).toUpperCase() + asset.category.slice(1)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 dark:text-white">
                        ₵{Number(asset.purchase_amount).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 dark:text-white">
                        ₵{Number(asset.current_value || 0).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600 dark:text-gray-400">
                        ₵{Number(asset.accumulated_depreciation || 0).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 text-xs font-semibold rounded-full ${
                            asset.status === "active"
                              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                              : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
                          }`}
                        >
                          {asset.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}


