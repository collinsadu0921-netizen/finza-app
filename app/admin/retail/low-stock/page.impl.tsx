"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { getUserStore } from "@/lib/stores"
import { getActiveStoreId } from "@/lib/storeSession"
import { getStockStatus, isLowStock } from "@/lib/inventory"

type Product = {
  id: string
  name: string
  barcode?: string
  stock_quantity?: number
  stock?: number
  low_stock_threshold?: number
  track_stock?: boolean
}

type LowStockProduct = Product & {
  currentStock: number
  status: "low_stock" | "out_of_stock"
  threshold: number
}

export default function LowStockReportPage() {
  const router = useRouter()
  const [products, setProducts] = useState<LowStockProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [hasAccess, setHasAccess] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Not logged in")
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }

      // Check permissions - only owner, admin, manager can view low stock report
      const role = await getUserRole(supabase, user.id, business.id)
      if (role !== "owner" && role !== "admin" && role !== "manager") {
        setError("You do not have permission to view this report")
        setLoading(false)
        return
      }

      setHasAccess(true)

      // Get active store from session (single source of truth)
      // NEVER fallback to user.store_id after session is created
      const activeStoreId = getActiveStoreId()
      const storeIdForStock = activeStoreId && activeStoreId !== 'all' ? activeStoreId : null

      // Load all products
      const { data: productsData, error: productsError } = await supabase
        .from("products")
        .select("id, name, barcode, stock_quantity, stock, low_stock_threshold, track_stock")
        .eq("business_id", business.id)
        .order("name", { ascending: true })

      if (productsError) {
        setError(`Error loading products: ${productsError.message}`)
        setLoading(false)
        return
      }

      if (!productsData || productsData.length === 0) {
        setProducts([])
        setLoading(false)
        return
      }

      // Load stock from products_stock table (per-store inventory)
      // Use active_store_id from session
      let stockQuery = supabase
        .from("products_stock")
        .select("product_id, variant_id, stock, stock_quantity, store_id")
        .in("product_id", productsData.map((p: any) => p.id))

      if (storeIdForStock) {
        stockQuery = stockQuery.eq("store_id", storeIdForStock)
      }
      // If storeIdForStock is null (activeStoreId is "all" or not set), aggregate across all stores

      const { data: stockData } = await stockQuery

      // Create a map of product_id -> stock (aggregate if multiple stores)
      const stockMap: Record<string, number> = {}
      if (stockData) {
        stockData.forEach((s: any) => {
          if (!s.variant_id) { // Only count non-variant stock for main products
            const currentStock = s.stock_quantity !== null && s.stock_quantity !== undefined
              ? Number(s.stock_quantity)
              : s.stock !== null && s.stock !== undefined
              ? Number(s.stock)
              : 0
            stockMap[s.product_id] = (stockMap[s.product_id] || 0) + currentStock
          }
        })
      }

      // Filter and process low stock products
      const lowStockProducts: LowStockProduct[] = (productsData || [])
        .map((p) => {
          // Use stock from products_stock if available, otherwise fallback to product.stock
          const currentStock = Math.floor(
            stockMap[p.id] !== undefined
              ? stockMap[p.id]
              : p.stock_quantity !== null && p.stock_quantity !== undefined
              ? Number(p.stock_quantity)
              : p.stock !== null && p.stock !== undefined
              ? Number(p.stock)
              : 0
          )
          const threshold = p.low_stock_threshold !== null && p.low_stock_threshold !== undefined
            ? Number(p.low_stock_threshold)
            : 5 // Default threshold

          const stockStatus = getStockStatus(currentStock, threshold, p.track_stock)

          if (stockStatus.status === "low_stock" || stockStatus.status === "out_of_stock") {
            return {
              ...p,
              currentStock,
              status: stockStatus.status,
              threshold,
            } as LowStockProduct
          }
          return null
        })
        .filter((p): p is LowStockProduct => p !== null)

      // Sort: Out of stock first, then low stock, then by name
      lowStockProducts.sort((a, b) => {
        if (a.status === "out_of_stock" && b.status !== "out_of_stock") return -1
        if (a.status !== "out_of_stock" && b.status === "out_of_stock") return 1
        if (a.status === "low_stock" && b.status !== "low_stock") return -1
        if (a.status !== "low_stock" && b.status === "low_stock") return 1
        return a.name.localeCompare(b.name)
      })

      setProducts(lowStockProducts)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load low stock report")
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </>
    )
  }

  if (error || !hasAccess) {
    return (
      <>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error || "Access denied"}
          </div>
          <button
            onClick={() => router.push("/retail/dashboard")}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Back to Dashboard
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="p-6">
        <div className="mb-6">
          <button
            onClick={() => router.push("/retail/dashboard")}
            className="text-blue-600 hover:underline mb-4"
          >
            ← Back to Dashboard
          </button>
          <h1 className="text-2xl font-bold mb-2">Low Stock Report</h1>
          <p className="text-gray-600">
            Products with low stock or out of stock items
          </p>
        </div>

        {products.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-gray-500">
            <p className="text-lg font-semibold mb-2">All products are in stock!</p>
            <p className="text-sm">No low stock or out of stock items found.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Product Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    SKU
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Current Stock
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Threshold
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {products.map((product) => (
                  <tr key={product.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                      {product.name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                      {product.barcode || "-"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
                      {product.currentStock}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-center">
                      <span
                        className={`px-2 py-1 rounded text-xs font-bold text-white ${
                          product.status === "out_of_stock"
                            ? "bg-red-500"
                            : "bg-yellow-500"
                        }`}
                      >
                        {product.status === "out_of_stock" ? "OUT" : "LOW"}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-600">
                      {product.threshold}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-center">
                      <button
                        onClick={() => router.push("/products")}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        View Product
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 text-sm text-gray-600">
          <p>Total items: {products.length}</p>
          <p>
            Out of stock: {products.filter((p) => p.status === "out_of_stock").length} | Low stock:{" "}
            {products.filter((p) => p.status === "low_stock").length}
          </p>
        </div>
      </div>
    </>
  )
}

