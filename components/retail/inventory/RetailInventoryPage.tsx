"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { retailPaths } from "@/lib/retail/routes"
import { getStockStatus } from "@/lib/inventory"
import { getActiveStoreId } from "@/lib/storeSession"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { useToast } from "@/components/ui/ToastProvider"
import { useConfirm } from "@/components/ui/ConfirmProvider"
import {
  RetailBackofficeBadge,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeEmpty,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
  RetailBackofficeAlert,
  RetailMenuSelect,
  type MenuSelectOption,
} from "@/components/retail/RetailBackofficeUi"

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

export default function RetailInventoryPage() {
  const router = useRouter()
  const { currencyCode, format, ready: currencyReady } = useBusinessCurrency()
  const toast = useToast()
  const { openConfirm } = useConfirm()
  const [products, setProducts] = useState<InventoryProduct[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const categoryFilterMenuOptions = useMemo(() => {
    const head: MenuSelectOption[] = [{ value: "", label: "All categories" }]
    return head.concat(categories.map((c) => ({ value: c.id, label: c.name })))
  }, [categories])
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
        return <RetailBackofficeBadge tone="danger">All variants out</RetailBackofficeBadge>
      }
      if (outOfStockVariants > 0) {
        return (
          <RetailBackofficeBadge tone="warning">
            {inStockVariants}/{totalVariants} in stock
          </RetailBackofficeBadge>
        )
      }
      return <RetailBackofficeBadge tone="success">{totalVariants} in stock</RetailBackofficeBadge>
    }

    // For non-variant products, use normal stock status
    const stockStatus = getStockStatus(product.stock, product.low_stock_threshold, product.track_stock)

    // Show badge for LOW or OUT status
    if (stockStatus.status === "out_of_stock") {
      return <RetailBackofficeBadge tone="danger">Out of stock</RetailBackofficeBadge>
    }
    if (stockStatus.status === "low_stock") {
      return <RetailBackofficeBadge tone="warning">Low stock</RetailBackofficeBadge>
    }
    if (stockStatus.status === "not_tracked") {
      return <RetailBackofficeBadge tone="neutral">Not tracked</RetailBackofficeBadge>
    }
    return <RetailBackofficeBadge tone="success">In stock</RetailBackofficeBadge>
  }

  if (loading) {
    return (
      <RetailBackofficeShell>
        <RetailBackofficeMain>
          <p className="text-sm text-slate-500">Loading inventory…</p>
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain>
        <RetailBackofficePageHeader
          eyebrow="Product & inventory"
          title="Inventory"
          description="Operational view of on-hand quantity, value, and status for the selected store."
          actions={
            <>
              <RetailBackofficeButton variant="secondary" onClick={() => router.push(retailPaths.dashboard)}>
                Dashboard
              </RetailBackofficeButton>
              <RetailBackofficeButton variant="secondary" onClick={() => router.push(retailPaths.pos)}>
                POS
              </RetailBackofficeButton>
              <RetailBackofficeButton variant="secondary" onClick={() => router.push(retailPaths.products)}>
                Products
              </RetailBackofficeButton>
              <RetailBackofficeButton variant="primary" onClick={() => router.push(retailPaths.inventoryHistory)}>
                Movement history
              </RetailBackofficeButton>
            </>
          }
        />

        {error ? (
          <RetailBackofficeAlert tone="warning" className="mb-6">
            {error}
          </RetailBackofficeAlert>
        ) : null}

        {products.length === 0 ? (
          <RetailBackofficeEmpty
            title="No products in this store"
            description="Add products to the catalog, then return here to manage stock and variants."
            action={
              <RetailBackofficeButton variant="primary" onClick={() => router.push(retailPaths.products)}>
                Go to products
              </RetailBackofficeButton>
            }
          />
        ) : (
          <>
            {/* Stock Value Summary */}
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
              const totalProducts = products.length

              return (
                <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <RetailBackofficeCard className="border-slate-200/90 bg-white" padding="p-5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Stock value</p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
                      {format(totalStockValue)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Selling price × on hand (variant products use each variant&apos;s price and quantity)
                    </p>
                  </RetailBackofficeCard>
                  <RetailBackofficeCard className="border-slate-200/90 bg-white" padding="p-5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Units on hand</p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
                      {formatInteger(totalItems)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Sum of sellable units (each variant counted separately)
                    </p>
                  </RetailBackofficeCard>
                  <RetailBackofficeCard className="border-slate-200/90 bg-white" padding="p-5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">SKU count</p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
                      {formatInteger(totalProducts)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Products in catalog</p>
                  </RetailBackofficeCard>
                </div>
              )
            })()}

            {/* Category Filter */}
            {categories.length > 0 && (
              <RetailBackofficeCard className="mb-6" padding="p-4">
                <label className="mb-2 block text-xs font-medium text-slate-600">Filter by category</label>
                <RetailMenuSelect
                  wrapperClassName="max-w-xs"
                  value={selectedCategory || ""}
                  onValueChange={(v) => setSelectedCategory(v || null)}
                  options={categoryFilterMenuOptions}
                />
              </RetailBackofficeCard>
            )}

            {(() => {
              // Filter products by category
              const filteredProducts = selectedCategory
                ? products.filter((p) => p.category_id === selectedCategory)
                : products

              if (filteredProducts.length === 0) {
                return (
                  <RetailBackofficeEmpty
                    title="Nothing in this category"
                    description="Choose another category or clear the filter."
                  />
                )
              }

                return (
                  <div className="space-y-3">
                  {filteredProducts.map((product) => {
                    const categoryName = product.category_id
                      ? categories.find((c) => c.id === product.category_id)?.name
                      : null

                    return (
                      <RetailBackofficeCard
                        key={product.id}
                        padding="p-5 sm:p-6"
                        className="transition-shadow hover:shadow-md"
                      >
                        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-start">
                          <div className="min-w-0 flex-1">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <h3 className="text-base font-semibold tracking-tight text-slate-900">{product.name}</h3>
                              {getStatusBadge(product)}
                              {categoryName ? (
                                <RetailBackofficeBadge tone="info">{categoryName}</RetailBackofficeBadge>
                              ) : null}
                            </div>
                            <div className="space-y-1 text-sm text-slate-600">
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
                          <div className="flex flex-col gap-2 sm:items-end">
                            {product.hasVariants && product.variants ? (
                              <p className="text-center text-xs text-slate-500 sm:text-right">Per-variant stock</p>
                            ) : (
                              <RetailBackofficeButton
                                variant="primary"
                                className="w-full sm:w-auto"
                                onClick={() => router.push(retailPaths.inventoryAddStock(product.id))}
                              >
                                Adjust stock
                              </RetailBackofficeButton>
                            )}
                          </div>
                        </div>
                        {/* Variant actions row */}
                        {product.hasVariants && product.variants && (
                          <div className="mt-2 pt-2 border-t">
                            <div className="space-y-2">
                              {product.variants.map((variant) => (
                                <div
                                  key={variant.id}
                                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-3"
                                >
                                  <span className="text-sm font-medium">{variant.variant_name}</span>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        router.push(
                                          `${retailPaths.inventoryAddStock(product.id)}?variant_id=${variant.id}&variant_name=${encodeURIComponent(variant.variant_name)}`,
                                        )
                                      }
                                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-slate-800"
                                    >
                                      Adjust
                                    </button>
                                    <button
                                      type="button"
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
                                      className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 shadow-sm hover:bg-red-50"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </RetailBackofficeCard>
                    )
                  })}
                </div>
              )
            })()}
          </>
        )}
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}
