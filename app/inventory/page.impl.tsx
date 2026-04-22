"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { usePathname, useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { getStockStatus } from "@/lib/inventory"
import {
  loadRetailInventoryPageData,
  DEFAULT_RETAIL_INVENTORY_PAGE_SIZE,
  type InventoryCategory,
  type InventoryProduct,
} from "@/lib/inventory/loadRetailInventoryPageData"
import {
  describeInventoryVariantDeleteError,
  inventoryNavigatedFromAddStockToList,
  resolveInventoryRepageAfterFetch,
} from "@/lib/inventory/inventoryListUiHelpers"
import { getActiveStoreId } from "@/lib/storeSession"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { useToast } from "@/components/ui/ToastProvider"
import { useConfirm } from "@/components/ui/ConfirmProvider"

const LEGACY_INVENTORY_LIST_PATH = "/inventory"

export default function InventoryPage() {
  const router = useRouter()
  const pathname = usePathname()
  const { currencyCode, format, ready: currencyReady } = useBusinessCurrency()
  const toast = useToast()
  const { openConfirm } = useConfirm()
  const [products, setProducts] = useState<InventoryProduct[]>([])
  const [categories, setCategories] = useState<InventoryCategory[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [listLoading, setListLoading] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [page, setPage] = useState(0)
  const [totalProductCount, setTotalProductCount] = useState(0)
  const [inventoryVersion, setInventoryVersion] = useState(0)
  const firstPaintRef = useRef(true)
  const fetchGenerationRef = useRef(0)
  const prevPathnameRef = useRef<string | null>(null)

  const bumpReload = useCallback(() => {
    setInventoryVersion((v) => v + 1)
  }, [])

  useEffect(() => {
    const prev = prevPathnameRef.current
    if (prev != null && inventoryNavigatedFromAddStockToList(pathname, prev, LEGACY_INVENTORY_LIST_PATH)) {
      bumpReload()
    }
    prevPathnameRef.current = pathname
  }, [pathname, bumpReload])

  useEffect(() => {
    const handleStoreChange = () => {
      firstPaintRef.current = true
      setSelectedCategory(null)
      setPage(0)
      setInventoryVersion((v) => v + 1)
    }

    window.addEventListener("storeChanged", handleStoreChange)

    return () => {
      window.removeEventListener("storeChanged", handleStoreChange)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const gen = ++fetchGenerationRef.current

    const run = async () => {
      if (firstPaintRef.current) {
        setLoading(true)
      } else {
        setListLoading(true)
      }
      setError("")
      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser()
        if (authError) {
          throw new Error(authError.message || "Could not verify your session.")
        }
        if (!user) {
          if (!cancelled && gen === fetchGenerationRef.current) {
            setError("You need to be signed in to view inventory.")
            setProducts([])
            setCategories([])
            setTotalProductCount(0)
          }
          return
        }

        const business = await getCurrentBusiness(supabase, user.id)
        if (!business) {
          if (!cancelled && gen === fetchGenerationRef.current) {
            setError("We could not find a business for your account. Check your workspace selection.")
            setProducts([])
            setCategories([])
            setTotalProductCount(0)
          }
          return
        }

        if (!cancelled && gen === fetchGenerationRef.current) setBusinessId(business.id)

        const activeStoreId = getActiveStoreId()

        if (!activeStoreId || activeStoreId === "all") {
          if (!cancelled && gen === fetchGenerationRef.current) {
            setError("Please select a store before viewing inventory. Go to Stores page and click 'Open Store'.")
            setProducts([])
            setCategories([])
            setTotalProductCount(0)
          }
          return
        }

        const { categories: nextCategories, products: nextProducts, totalProductCount: nextTotal } =
          await loadRetailInventoryPageData(supabase, business.id, activeStoreId, {
            page,
            pageSize: DEFAULT_RETAIL_INVENTORY_PAGE_SIZE,
            categoryId: selectedCategory,
          })

        if (cancelled || gen !== fetchGenerationRef.current) return

        if (nextTotal <= 0) {
          setCategories(nextCategories)
          setProducts([])
          setTotalProductCount(0)
          if (page !== 0) setPage(0)
          return
        }

        const repage = resolveInventoryRepageAfterFetch({
          currentPage: page,
          nextTotal,
          nextProductsLength: nextProducts.length,
          pageSize: DEFAULT_RETAIL_INVENTORY_PAGE_SIZE,
        })
        if (repage !== null) {
          setPage(repage)
          return
        }

        setCategories(nextCategories)
        setProducts(nextProducts)
        setTotalProductCount(nextTotal)
      } catch (err: unknown) {
        if (cancelled || gen !== fetchGenerationRef.current) return
        const message =
          err instanceof Error
            ? err.message
            : "We couldn't load inventory. Please check your connection and try again."
        console.error("[InventoryPage] loadInventory failed", err)
        setError(message)
        setProducts([])
        setCategories([])
        setTotalProductCount(0)
      } finally {
        if (cancelled || gen !== fetchGenerationRef.current) return
        setListLoading(false)
        if (firstPaintRef.current) {
          setLoading(false)
          firstPaintRef.current = false
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [page, selectedCategory, inventoryVersion])

  const totalPages = Math.max(1, Math.ceil(totalProductCount / DEFAULT_RETAIL_INVENTORY_PAGE_SIZE))
  const showPagination = totalProductCount > DEFAULT_RETAIL_INVENTORY_PAGE_SIZE

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
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Inventory Management</h1>
        <div className="flex flex-wrap gap-2">
          <a
            href="/inventory/history"
            className="rounded bg-purple-600 px-4 py-2 text-white hover:bg-purple-700"
          >
            View History
          </a>
          <a
            href="/retail/products"
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            + Add Product
          </a>
          <a href="/sales" className="rounded bg-gray-300 px-4 py-2 text-gray-800 hover:bg-gray-400">
            POS
          </a>
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="rounded bg-gray-300 px-4 py-2 text-gray-800 hover:bg-gray-400"
          >
            Dashboard
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => bumpReload()}
            className="shrink-0 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100"
          >
            Try again
          </button>
        </div>
      ) : null}

      {error ? null : totalProductCount === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
          <p className="mb-4 text-gray-600">
            {selectedCategory ? "No products in this category." : "No products found."}
          </p>
          {!selectedCategory ? (
            <>
              <p className="mb-4 text-sm text-gray-500">Add your first product to start managing inventory.</p>
              <a
                href="/retail/products"
                className="inline-block rounded bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
              >
                + Add Product
              </a>
            </>
          ) : (
            <p className="text-sm text-gray-500">Choose another category or clear the filter.</p>
          )}
        </div>
      ) : (
        <>
          {listLoading && !loading ? (
            <p className="mb-4 text-sm text-gray-500">Updating inventory…</p>
          ) : null}

          {/* Stock value / units are for this page only when paginated */}
          {(() => {
            let totalStockValue = 0
            let totalItems = 0
            for (const product of products) {
              if (product.hasVariants && product.variants && product.variants.length > 0) {
                for (const v of product.variants) {
                  const unitPrice =
                    v.price != null && !Number.isNaN(Number(v.price)) ? Number(v.price) : product.price
                  totalStockValue += v.stock * unitPrice
                  totalItems += v.stock
                }
              } else {
                totalStockValue += product.stock * product.price
                totalItems += product.stock
              }
            }
            const pageNote = showPagination ? " (this page)" : ""

            return (
              <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <div className="text-sm font-medium text-blue-600">Total Stock Value{pageNote}</div>
                  <div className="text-2xl font-bold text-blue-900">{format(totalStockValue)}</div>
                </div>
                <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                  <div className="text-sm font-medium text-green-600">Total Items in Stock{pageNote}</div>
                  <div className="text-2xl font-bold text-green-900">{formatInteger(totalItems)}</div>
                </div>
                <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
                  <div className="text-sm font-medium text-purple-600">Products (matching view)</div>
                  <div className="text-2xl font-bold text-purple-900">{formatInteger(totalProductCount)}</div>
                  {showPagination ? (
                    <div className="mt-1 text-xs text-purple-800/80">{products.length} on this page</div>
                  ) : null}
                </div>
              </div>
            )
          })()}

            {/* Category Filter */}
            {categories.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                <select
                  className="rounded border p-2"
                  value={selectedCategory || ""}
                  onChange={(e) => {
                    setSelectedCategory(e.target.value || null)
                    setPage(0)
                  }}
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

            {showPagination ? (
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-600">
                  Page <span className="font-semibold tabular-nums">{page + 1}</span> of{" "}
                  <span className="font-semibold tabular-nums">{totalPages}</span>
                  <span className="text-gray-400"> · </span>
                  <span className="tabular-nums text-gray-500">{totalProductCount} products</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={listLoading || page <= 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={listLoading || page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}

            {products.length === 0 && totalProductCount > 0 ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
                <p className="mb-4 text-gray-600">No products on this page.</p>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                >
                  Go to previous page
                </button>
              </div>
            ) : (
              <div className={`space-y-2 ${listLoading && !loading ? "opacity-60" : ""}`}>
                {products.map((product) => {
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
                                                toast.showToast(describeInventoryVariantDeleteError(error), "error")
                                              } else {
                                                bumpReload()
                                              }
                                            } catch (err: unknown) {
                                              toast.showToast(
                                                describeInventoryVariantDeleteError(
                                                  err && typeof err === "object" ? (err as { message?: string }) : null,
                                                ),
                                                "error",
                                              )
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
            )}
        </>
      )}
    </div>
  )
}
