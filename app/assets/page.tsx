"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import LoadingScreen from "@/components/ui/LoadingScreen"
import PageHeader from "@/components/ui/PageHeader"
import Button from "@/components/ui/Button"
import EmptyState from "@/components/ui/EmptyState"
import { useToast } from "@/components/ui/ToastProvider"

type Asset = {
  id: string
  name: string
  asset_code: string | null
  category: string
  purchase_date: string
  purchase_amount: number
  current_value: number
  accumulated_depreciation: number
  status: string
  supplier_name: string | null
}

export default function AssetsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [assets, setAssets] = useState<Asset[]>([])
  const [filteredAssets, setFilteredAssets] = useState<Asset[]>([])
  const [searchInput, setSearchInput] = useState<string>("")
  const [searchQuery, setSearchQuery] = useState<string>("")
  const [isSearching, setIsSearching] = useState(false)
  const [filters, setFilters] = useState({
    category: "",
    status: "",
  })
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    loadAssets()
  }, [])

  // Debounced search effect - updates searchQuery after user stops typing
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }

    // Only show searching indicator if there's actual input
    if (searchInput.trim()) {
      setIsSearching(true)
    }

    searchDebounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput)
      setIsSearching(false)
    }, 300)

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [searchInput])

  useEffect(() => {
    applyFilters()
  }, [assets, filters, searchQuery])

  const loadAssets = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) return

      const response = await fetch("/api/assets/list")
      const data = await response.json()

      if (response.ok) {
        setAssets(data.assets || [])
      } else {
        console.error("Error loading assets:", data.error)
      }
    } catch (error) {
      console.error("Error loading assets:", error)
    } finally {
      setLoading(false)
    }
  }

  const applyFilters = () => {
    let filtered = [...assets]

    // Apply category filter
    if (filters.category) {
      filtered = filtered.filter((a) => a.category === filters.category)
    }

    // Apply status filter
    if (filters.status) {
      filtered = filtered.filter((a) => a.status === filters.status)
    }

    // Apply search query (debounced) - search in name, asset_code, and supplier_name
    if (searchQuery.trim()) {
      const searchLower = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (a) =>
          (a.name && a.name.toLowerCase().includes(searchLower)) ||
          (a.asset_code && a.asset_code.toLowerCase().includes(searchLower)) ||
          (a.supplier_name && a.supplier_name.toLowerCase().includes(searchLower))
      )
    }

    setFilteredAssets(filtered)
  }

  const categories = ["vehicle", "equipment", "furniture", "electronics", "tools", "other"]

  if (loading) {
    return (
      <ProtectedLayout>
        <LoadingScreen />
      </ProtectedLayout>
    )
  }

  const totalCost = filteredAssets.reduce((sum, a) => sum + Number(a.purchase_amount), 0)
  const totalDepreciation = filteredAssets.reduce(
    (sum, a) => sum + Number(a.accumulated_depreciation || 0),
    0
  )
  const totalNetValue = filteredAssets.reduce((sum, a) => sum + Number(a.current_value || 0), 0)

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PageHeader
            title="Assets"
            subtitle="Manage fixed assets and depreciation"
            actions={
              <Button
                onClick={() => router.push("/assets/create")}
                leftIcon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                }
              >
                Add Asset
              </Button>
            }
          />

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-gray-600 text-sm font-medium mb-2">Total Cost</h3>
              <p className="text-2xl font-bold text-gray-900">
                ₵{totalCost.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-gray-600 text-sm font-medium mb-2">Accumulated Depreciation</h3>
              <p className="text-2xl font-bold text-gray-900">
                ₵{totalDepreciation.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-gray-600 text-sm font-medium mb-2">Net Book Value</h3>
              <p className="text-2xl font-bold text-gray-900">
                ₵{totalNetValue.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-1">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Search</label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Asset name, code, or supplier..."
                    className="w-full min-w-0 border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  />
                  {isSearching && (
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                      <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Category</label>
                <select
                  value={filters.category}
                  onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">All Categories</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">All Status</option>
                  <option value="active">Active</option>
                  <option value="disposed">Disposed</option>
                </select>
              </div>
            </div>
          </div>

          {/* Assets Table */}
          {filteredAssets.length === 0 ? (
            <EmptyState
              icon={
                <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              }
              title="No assets found"
              description="Start tracking your fixed assets by adding your first asset."
              actionLabel="Add Asset"
              onAction={() => router.push("/assets/create")}
            />
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Asset Code
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Category
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Purchase Amount
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Current Value
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Depreciation
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredAssets.map((asset) => (
                      <tr 
                        key={asset.id} 
                        onClick={() => router.push(`/assets/${asset.id}`)}
                        className="hover:bg-gray-50 transition-colors cursor-pointer"
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {asset.asset_code || "N/A"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {asset.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {asset.category.charAt(0).toUpperCase() + asset.category.slice(1)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          ₵{Number(asset.purchase_amount).toFixed(2)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          ₵{Number(asset.current_value || 0).toFixed(2)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          ₵{Number(asset.accumulated_depreciation || 0).toFixed(2)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-1 text-xs font-semibold rounded-full ${
                              asset.status === "active"
                                ? "bg-green-100 text-green-800"
                                : "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {asset.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => router.push(`/assets/${asset.id}`)}
                            className="text-blue-600 hover:text-blue-800 font-medium transition-colors"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}


