"use client"

import { useEffect, useState, useMemo } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { getStockStatus, StockStatusInfo } from "@/lib/inventory"
import { getActiveStoreId } from "@/lib/storeSession"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { useToast } from "@/components/ui/ToastProvider"
import { useConfirm } from "@/components/ui/ConfirmProvider"

type Category = {
  id: string
  name: string
}

type InventoryProduct = {
  id: string
  name: string
  price: number
  stock: number
  stock_quantity?: number
  low_stock_threshold?: number
  track_stock?: boolean
  category_id?: string
  hasVariants?: boolean
  variants?: Array<{
    id: string
    variant_name: string
    stock: number
    price?: number
  }>
}

export default function InventoryPage() {
  const router = useRouter()
  const { currencyCode, format, ready: currencyReady } = useBusinessCurrency()
  const toast = useToast()
  const { openConfirm } = useConfirm()
  const [products, setProducts] = useState<InventoryProduct[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")

  useEffect(() => {
    loadInventory()

    // Reload when store changes
    const handleStoreChange = () => {
      loadInventory()
    }

    window.addEventListener('storeChanged', handleStoreChange)

    return () => {
      window.removeEventListener('storeChanged', handleStoreChange)
    }
  }, [])

  const loadInventory = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
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

      // Get active store - inventory MUST be store-specific
      const activeStoreId = getActiveStoreId()

      if (!activeStoreId || activeStoreId === 'all') {
        setError("Please select a store before viewing inventory. Go to Stores page and click 'Open Store'.")
        setProducts([])
        setCategories([])
        setLoading(false)
        return
      }

      // Load categories
      const { data: cats } = await supabase
        .from("categories")
        .select("id, name")
        .eq("business_id", business.id)
        .order("name", { ascending: true })

      setCategories(cats || [])

      // Load products
      const { data: prods } = await supabase
        .from("products")
        .select("*")
        .eq("business_id", business.id)
        .order("name", { ascending: true })

      if (!prods || prods.length === 0) {
        setProducts([])
        setLoading(false)
        return
      }

      // Load stock from products_stock for active store (base products only)
      const { data: stockData } = await supabase
        .from("products_stock")
        .select("product_id, variant_id, stock")
        .eq("store_id", activeStoreId)
        .is("variant_id", null)
        .in("product_id", prods.map((p: any) => p.id))

      // Create stock map for base products
      const stockMap = new Map<string, number>()
      if (stockData) {
        stockData.forEach((record: any) => {
          stockMap.set(record.product_id, Number(record.stock || 0))
        })
      }

      // Check which products have variants
      const productsWithVariants = new Set<string>()
      const productVariantsMap = new Map<string, Array<{ id: string; variant_name: string; price?: number }>>()
      
      try {
        const { data: variantsData } = await supabase
          .from("products_variants")
          .select("id, product_id, variant_name, price")
          .in("product_id", prods.map((p: any) => p.id))

        if (variantsData) {
          variantsData.forEach((v: any) => {
            productsWithVariants.add(v.product_id)
            if (!productVariantsMap.has(v.product_id)) {
              productVariantsMap.set(v.product_id, [])
            }
            productVariantsMap.get(v.product_id)!.push({
              id: v.id,
              variant_name: v.variant_name,
              price: v.price ? Number(v.price) : undefined,
            })
          })
        }
      } catch (err: any) {
        // If table doesn't exist or permission denied, continue without variants
        if (
          err?.code !== "42P01" &&
          err?.code !== "42501" &&
          !err?.message?.includes("does not exist") &&
          !err?.message?.includes("schema cache")
        ) {
          console.error("Error checking variants:", err)
        }
      }

      // Load variant stock
      const variantStockMap = new Map<string, number>()
      if (productsWithVariants.size > 0) {
        const variantIds = Array.from(productVariantsMap.values()).flat().map(v => v.id)
        if (variantIds.length > 0) {
          try {
            const { data: variantStockData } = await supabase
              .from("products_stock")
              .select("variant_id, stock")
              .eq("store_id", activeStoreId)
              .in("variant_id", variantIds)
              .not("variant_id", "is", null)

            if (variantStockData) {
              variantStockData.forEach((record: any) => {
                variantStockMap.set(record.variant_id, Number(record.stock || 0))
              })
            }
          } catch (err: any) {
            console.error("Error loading variant stock:", err)
          }
        }
      }

      const inventoryProducts: InventoryProduct[] = (prods || []).map((p) => {
        // Use stock from products_stock for active store
        const storeStock = stockMap.get(p.id) ?? 0
        const stockQty = Math.floor(storeStock)
        const hasVariants = productsWithVariants.has(p.id)

        // Load variants with stock if product has variants
        let variants: Array<{ id: string; variant_name: string; stock: number; price?: number }> | undefined
        if (hasVariants) {
          const variantList = productVariantsMap.get(p.id) || []
          variants = variantList.map(v => ({
            ...v,
            stock: Math.floor(variantStockMap.get(v.id) ?? 0),
          }))
        }

        return {
          id: p.id,
          name: p.name,
          price: Number(p.price),
          stock: stockQty,
          stock_quantity: stockQty,
          low_stock_threshold: p.low_stock_threshold ? Number(p.low_stock_threshold) : undefined,
          track_stock: p.track_stock !== undefined ? p.track_stock : true,
          category_id: p.category_id || undefined,
          hasVariants: hasVariants,
          variants: variants,
        }
      })

      setProducts(inventoryProducts)
      setLoading(false)
    } catch (err: any) {
      setLoading(false)
    }
  }

  const formatNumber = (num: number): string => {
    return num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  const formatInteger = (num: number): string => {
    return num.toLocaleString('en-US')
  }

  const getStatusBadge = (product: InventoryProduct) => {
    // For products with variants, show variant summary instead of stock status
    if (product.hasVariants && product.variants) {
      const totalVariants = product.variants.length
      const inStockVariants = product.variants.filter(v => v.stock > 0).length
      const outOfStockVariants = product.variants.filter(v => v.stock === 0).length
      
      if (outOfStockVariants === totalVariants) {
        return (
          <span className="px-2 py-1 rounded text-xs font-bold text-white bg-red-600">
            All Variants Out
          </span>
        )
      } else if (outOfStockVariants > 0) {
        return (
          <span className="px-2 py-1 rounded text-xs font-semibold bg-yellow-100 text-yellow-800">
            {inStockVariants}/{totalVariants} Variants In Stock
          </span>
        )
      } else {
        return (
          <span className="px-2 py-1 rounded text-xs font-semibold bg-green-100 text-green-800">
            {totalVariants} Variants In Stock
          </span>
        )
      }
    }

    // For non-variant products, use normal stock status
    const stockStatus = getStockStatus(product.stock, product.low_stock_threshold, product.track_stock)

    // Show badge for LOW or OUT status
    if (stockStatus.status === "low_stock" || stockStatus.status === "out_of_stock") {
      return (
        <span className={`px-2 py-1 rounded text-xs font-bold text-white ${stockStatus.badgeColor}`}>
          {stockStatus.label}
        </span>
      )
    }

    return (
      <span className={`px-2 py-1 rounded text-xs font-semibold ${stockStatus.color}`}>
        {stockStatus.label}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="p-6">
        <p>Loading inventory...</p>
      </div>
    )
  }

  return (
    <div className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Inventory Management</h1>
          <div className="flex gap-2">
            <a
              href="/inventory/history"
              className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
            >
              View History
            </a>
            <a
              href="/retail/products"
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              + Add Product
            </a>
            <a
              href="/sales"
              className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
            >
              POS
            </a>
            <button
              onClick={() => router.push("/dashboard")}
              className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
            >
              Dashboard
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}
        </div>

        {products.length === 0 ? (
          <div className="border p-8 rounded-lg text-center bg-gray-50">
            <p className="text-gray-600 mb-4">No products found.</p>
            <p className="text-sm text-gray-500 mb-4">
              Add your first product to start managing inventory.
            </p>
            <a
              href="/retail/products"
              className="bg-blue-600 text-white px-6 py-2 rounded inline-block hover:bg-blue-700"
            >
              + Add Product
            </a>
          </div>
        ) : (
          <>
            {/* Stock Value Summary */}
            {(() => {
              const totalStockValue = products.reduce(
                (sum, product) => sum + product.stock * product.price,
                0
              )
              const totalItems = products.reduce((sum, product) => sum + product.stock, 0)
              const totalProducts = products.length

              return (
                <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="text-sm text-blue-600 font-medium">Total Stock Value</div>
                    <div className="text-2xl font-bold text-blue-900">
                      {format(totalStockValue)}
                    </div>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="text-sm text-green-600 font-medium">Total Items in Stock</div>
                    <div className="text-2xl font-bold text-green-900">{formatInteger(totalItems)}</div>
                  </div>
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                    <div className="text-sm text-purple-600 font-medium">Total Products</div>
                    <div className="text-2xl font-bold text-purple-900">{formatInteger(totalProducts)}</div>
                  </div>
                </div>
              )
            })()}

            {/* Category Filter */}
            {categories.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                <select
                  className="border p-2 rounded"
                  value={selectedCategory || ""}
                  onChange={(e) => setSelectedCategory(e.target.value || null)}
                >
                  <option value="">All Categories</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(() => {
              // Filter products by category
              const filteredProducts = selectedCategory
                ? products.filter((p) => p.category_id === selectedCategory)
                : products

              if (filteredProducts.length === 0) {
                return (
                  <div className="border p-8 rounded-lg text-center bg-gray-50">
                    <p className="text-gray-600 mb-4">No products found in this category.</p>
                  </div>
                )
              }

              return (
                <div className="space-y-2">
                  {filteredProducts.map((product) => {
                    const categoryName = product.category_id
                      ? categories.find((c) => c.id === product.category_id)?.name
                      : null

                    return (
                      <div
                        key={product.id}
                        className="border p-4 rounded-lg bg-white hover:bg-gray-50"
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="font-semibold text-lg">{product.name}</h3>
                              {getStatusBadge(product)}
                              {categoryName && (
                                <span className="px-2 py-1 rounded text-xs bg-blue-100 text-blue-800">
                                  {categoryName}
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-gray-600 space-y-1">
                              {product.hasVariants && product.variants ? (
                                <>
                                  <p className="font-semibold text-gray-900">
                                    Variants ({product.variants.length}):
                                  </p>
                                  <div className="ml-4 space-y-1 mt-1">
                                    {product.variants.map((variant) => {
                                      const isOut = variant.stock === 0
                                      return (
                                        <div key={variant.id} className="flex items-center gap-2">
                                          <span className={isOut ? 'text-red-600 font-medium' : ''}>
                                            {variant.variant_name}: {formatInteger(variant.stock)} units
                                          </span>
                                          {isOut && (
                                            <span className="px-1.5 py-0.5 rounded text-xs font-bold text-white bg-red-600">
                                              OUT
                                            </span>
                                          )}
                                          {variant.price !== undefined && variant.price !== product.price && (
                                            <span className="text-xs text-gray-500">
                                              ({format(variant.price)})
                                            </span>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <p>
                                    Stock: <span className="font-semibold">{formatInteger(product.stock)}</span> units
                                  </p>
                                  <p>
                                    Price: <span className="font-semibold">{format(product.price)}</span>
                                  </p>
                                  <p>
                                    Value: <span className="font-semibold">{format(product.stock * product.price)}</span>
                                  </p>
                                  {product.low_stock_threshold !== undefined && product.low_stock_threshold > 0 && (
                                    <p className="text-xs">
                                      Low stock threshold: {product.low_stock_threshold}
                                    </p>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col gap-2">
                            {product.hasVariants && product.variants ? (
                              <div className="text-xs text-gray-500 italic text-center">
                                Manage stock per variant
                              </div>
                            ) : (
                              <button
                                onClick={() => router.push(`/inventory/${product.id}/add-stock`)}
                                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                              >
                                Add Stock
                              </button>
                            )}
                          </div>
                        </div>
                        {/* Variant actions row */}
                        {product.hasVariants && product.variants && (
                          <div className="mt-2 pt-2 border-t">
                            <div className="space-y-2">
                              {product.variants.map((variant) => (
                                <div key={variant.id} className="flex items-center justify-between gap-2 bg-gray-50 p-2 rounded">
                                  <span className="text-sm font-medium">{variant.variant_name}</span>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => router.push(`/inventory/${product.id}/add-stock?variant_id=${variant.id}&variant_name=${encodeURIComponent(variant.variant_name)}`)}
                                      className="bg-green-600 text-white px-3 py-1 rounded text-xs hover:bg-green-700"
                                    >
                                      Add Stock
                                    </button>
                                    <button
                                      onClick={() => {
                                        openConfirm({
                                          title: "Delete variant",
                                          description: `Are you sure you want to delete variant "${variant.variant_name}"? This action cannot be undone.`,
                                          onConfirm: async () => {
                                            try {
                                              const { error } = await supabase
                                                .from("products_variants")
                                                .delete()
                                                .eq("id", variant.id)
                                              if (error) {
                                                toast.showToast(`Error deleting variant: ${error.message}`, "error")
                                              } else {
                                                loadInventory()
                                              }
                                            } catch (err: any) {
                                              toast.showToast(`Error deleting variant: ${err.message}`, "error")
                                            }
                                          },
                                        })
                                      }}
                                      className="bg-red-600 text-white px-3 py-1 rounded text-xs hover:bg-red-700"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </>
        )}
      </div>
  )
}
