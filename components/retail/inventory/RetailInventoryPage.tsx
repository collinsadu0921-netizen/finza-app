"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { usePathname, useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { retailPaths } from "@/lib/retail/routes"
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
import { getActiveStoreId, getActiveStoreName, setActiveStoreId } from "@/lib/storeSession"
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

export default function RetailInventoryPage() {
  const router = useRouter()
  const pathname = usePathname()
  const { currencyCode, format, ready: currencyReady } = useBusinessCurrency()
  const toast = useToast()
  const { openConfirm } = useConfirm()
  const [products, setProducts] = useState<InventoryProduct[]>([])
  const [categories, setCategories] = useState<InventoryCategory[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const categoryFilterMenuOptions = useMemo(() => {
    const head: MenuSelectOption[] = [{ value: "", label: "All categories" }]
    return head.concat(categories.map((c) => ({ value: c.id, label: c.name })))
  }, [categories])
  const [loading, setLoading] = useState(true)
  const [listLoading, setListLoading] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [page, setPage] = useState(0)
  const [totalProductCount, setTotalProductCount] = useState(0)
  const [inventoryVersion, setInventoryVersion] = useState(0)
  const [activeStoreName, setActiveStoreName] = useState<string | null>(null)
  const [storeOptions, setStoreOptions] = useState<Array<{ id: string; name: string }>>([])
  /** Full-screen loading only for the first successful load (or after store change). */
  const firstPaintRef = useRef(true)
  /** Suppresses applying stale fetch results when page, filters, or version change mid-request. */
  const fetchGenerationRef = useRef(0)
  const prevPathnameRef = useRef<string | null>(null)

  const bumpReload = useCallback(() => {
    setInventoryVersion((v) => v + 1)
  }, [])

  useEffect(() => {
    const prev = prevPathnameRef.current
    if (prev != null && inventoryNavigatedFromAddStockToList(pathname, prev, retailPaths.inventory)) {
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
        const sessionStoreName = getActiveStoreName()
        if (!cancelled && gen === fetchGenerationRef.current) {
          setActiveStoreName(sessionStoreName)
        }

        const { data: storesData, error: storesError } = await supabase
          .from("stores")
          .select("id, name")
          .eq("business_id", business.id)
          .order("name", { ascending: true })

        if (storesError) {
          throw new Error(storesError.message || "Failed to load stores")
        }
        if (!cancelled && gen === fetchGenerationRef.current) {
          setStoreOptions((storesData || []) as Array<{ id: string; name: string }>)
          if (activeStoreId && activeStoreId !== "all" && !sessionStoreName) {
            const matched = (storesData || []).find((s: { id: string; name: string }) => s.id === activeStoreId)
            setActiveStoreName(matched?.name ?? null)
          }
        }

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
        console.error("[RetailInventoryPage] loadInventory failed", err)
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
          <RetailBackofficeAlert tone="error" className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <RetailBackofficeButton type="button" variant="secondary" className="shrink-0" onClick={() => bumpReload()}>
              Try again
            </RetailBackofficeButton>
          </RetailBackofficeAlert>
        ) : null}

        <RetailBackofficeCard className="mb-6 border-slate-200/90 bg-white" padding="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active store</p>
              <p className="mt-1 text-sm text-slate-700">
                {activeStoreName ? (
                  <>Showing inventory for <span className="font-semibold">{activeStoreName}</span>.</>
                ) : (
                  "No active store selected."
                )}
              </p>
            </div>
            <div className="w-full sm:w-72">
              <label className="mb-1 block text-xs font-medium text-slate-600">Switch store</label>
              <RetailMenuSelect
                value={getActiveStoreId() && getActiveStoreId() !== "all" ? (getActiveStoreId() as string) : ""}
                onValueChange={(value) => {
                  if (!value) return
                  const selected = storeOptions.find((s) => s.id === value)
                  setActiveStoreId(value, selected?.name ?? null)
                  setActiveStoreName(selected?.name ?? null)
                }}
                options={[
                  { value: "", label: "Choose store…" },
                  ...storeOptions.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </div>
          </div>
        </RetailBackofficeCard>

        {error ? null : totalProductCount === 0 ? (
          <RetailBackofficeEmpty
            title={selectedCategory ? "Nothing in this category" : "No products in this store"}
            description={
              selectedCategory
                ? "Choose another category or clear the filter."
                : "Add products to the catalog, then return here to manage stock and variants."
            }
            action={
              !selectedCategory ? (
                <RetailBackofficeButton variant="primary" onClick={() => router.push(retailPaths.products)}>
                  Go to products
                </RetailBackofficeButton>
              ) : undefined
            }
          />
        ) : (
          <>
            {listLoading && !loading ? (
              <p className="mb-4 text-sm text-slate-500">Updating inventory…</p>
            ) : null}

            {/* Stock Value Summary — figures are for the current page only when paginated */}
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
              const pageSliceNote = showPagination ? "This page only." : ""

              return (
                <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <RetailBackofficeCard className="min-w-0 border-slate-200/90 bg-white" padding="p-5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Stock value</p>
                    <p className="mt-2 text-base font-semibold tabular-nums leading-tight tracking-tight text-slate-900 [overflow-wrap:anywhere] sm:text-lg md:text-xl lg:text-2xl">
                      {format(totalStockValue)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Selling price × on hand (variant products use each variant&apos;s price and quantity)
                      {pageSliceNote ? ` ${pageSliceNote}` : ""}
                    </p>
                  </RetailBackofficeCard>
                  <RetailBackofficeCard className="min-w-0 border-slate-200/90 bg-white" padding="p-5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Units on hand</p>
                    <p className="mt-2 text-xl font-semibold tabular-nums leading-tight tracking-tight text-slate-900 [overflow-wrap:anywhere] sm:text-2xl">
                      {formatInteger(totalItems)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Sum of sellable units (each variant counted separately)
                      {pageSliceNote ? ` ${pageSliceNote}` : ""}
                    </p>
                  </RetailBackofficeCard>
                  <RetailBackofficeCard className="min-w-0 border-slate-200/90 bg-white" padding="p-5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">SKU count</p>
                    <p className="mt-2 text-xl font-semibold tabular-nums leading-tight tracking-tight text-slate-900 [overflow-wrap:anywhere] sm:text-2xl">
                      {formatInteger(totalProductCount)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Products matching this view
                      {showPagination ? ` · ${products.length} on this page` : ""}
                    </p>
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
                  onValueChange={(v) => {
                    setSelectedCategory(v || null)
                    setPage(0)
                  }}
                  options={categoryFilterMenuOptions}
                />
              </RetailBackofficeCard>
            )}

            {showPagination ? (
              <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-600">
                  Page <span className="font-semibold tabular-nums">{page + 1}</span> of{" "}
                  <span className="font-semibold tabular-nums">{totalPages}</span>
                  <span className="text-slate-400"> · </span>
                  <span className="tabular-nums text-slate-500">{totalProductCount} products</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <RetailBackofficeButton
                    type="button"
                    variant="secondary"
                    disabled={listLoading || page <= 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </RetailBackofficeButton>
                  <RetailBackofficeButton
                    type="button"
                    variant="secondary"
                    disabled={listLoading || page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </RetailBackofficeButton>
                </div>
              </div>
            ) : null}

            {products.length === 0 && totalProductCount > 0 ? (
              <RetailBackofficeEmpty
                title="No products on this page"
                description="Try the previous page or reload."
                action={
                  <RetailBackofficeButton type="button" variant="secondary" onClick={() => setPage((p) => Math.max(0, p - 1))}>
                    Go to previous page
                  </RetailBackofficeButton>
                }
              />
            ) : (
              <div className={`space-y-3 ${listLoading && !loading ? "opacity-60" : ""}`}>
                {products.map((product) => {
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
                                          <span className="text-xs text-slate-500">
                                            Avg cost: {formatNumber(variant.average_cost || 0)}
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
                                    Avg cost: <span className="font-semibold">{formatNumber(product.average_cost || 0)}</span>
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
            )}
          </>
        )}
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}
