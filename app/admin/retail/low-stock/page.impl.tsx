"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { getUserStore } from "@/lib/stores"
import { getActiveStoreId } from "@/lib/storeSession"
import { getStockStatus } from "@/lib/inventory"
import { retailPaths } from "@/lib/retail/routes"
import {
  RetailBackofficeBadge,
  RetailBackofficeBackLink,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeCardTitle,
  RetailBackofficeEmpty,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
  RetailBackofficeAlert,
} from "@/components/retail/RetailBackofficeUi"

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
  variant_id?: string | null
  variant_name?: string | null
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

      const { data: variantsData } = await supabase
        .from("products_variants")
        .select("id, product_id, variant_name, barcode")
        .in("product_id", productsData.map((x: { id: string }) => x.id))

      const variantsByProduct = new Map<
        string,
        Array<{ id: string; variant_name: string; barcode: string | null }>
      >()
      const productIdsWithVariants = new Set<string>()
      for (const v of variantsData || []) {
        productIdsWithVariants.add(v.product_id)
        if (!variantsByProduct.has(v.product_id)) {
          variantsByProduct.set(v.product_id, [])
        }
        variantsByProduct.get(v.product_id)!.push({
          id: v.id,
          variant_name: v.variant_name,
          barcode: v.barcode ?? null,
        })
      }

      const parentStockMap: Record<string, number> = {}
      const variantStockMap: Record<string, number> = {}
      if (stockData) {
        stockData.forEach((s: any) => {
          const rowQty =
            s.stock_quantity !== null && s.stock_quantity !== undefined
              ? Number(s.stock_quantity)
              : s.stock !== null && s.stock !== undefined
                ? Number(s.stock)
                : 0
          if (s.variant_id) {
            variantStockMap[s.variant_id] = (variantStockMap[s.variant_id] || 0) + rowQty
          } else {
            parentStockMap[s.product_id] = (parentStockMap[s.product_id] || 0) + rowQty
          }
        })
      }

      const lowStockProducts: LowStockProduct[] = []

      for (const p of productsData || []) {
        const threshold =
          p.low_stock_threshold !== null && p.low_stock_threshold !== undefined
            ? Number(p.low_stock_threshold)
            : 5

        if (productIdsWithVariants.has(p.id)) {
          const vlist = variantsByProduct.get(p.id) || []
          for (const v of vlist) {
            const currentStock = Math.floor(variantStockMap[v.id] ?? 0)
            const stockStatus = getStockStatus(currentStock, threshold, p.track_stock)
            if (stockStatus.status === "low_stock" || stockStatus.status === "out_of_stock") {
              lowStockProducts.push({
                ...p,
                barcode: v.barcode ?? p.barcode ?? undefined,
                currentStock,
                status: stockStatus.status,
                threshold,
                variant_id: v.id,
                variant_name: v.variant_name,
              })
            }
          }
          continue
        }

        const currentStock = Math.floor(
          parentStockMap[p.id] !== undefined
            ? parentStockMap[p.id]
            : p.stock_quantity !== null && p.stock_quantity !== undefined
              ? Number(p.stock_quantity)
              : p.stock !== null && p.stock !== undefined
                ? Number(p.stock)
                : 0
        )
        const stockStatus = getStockStatus(currentStock, threshold, p.track_stock)
        if (stockStatus.status === "low_stock" || stockStatus.status === "out_of_stock") {
          lowStockProducts.push({
            ...p,
            currentStock,
            status: stockStatus.status,
            threshold,
            variant_id: null,
          })
        }
      }

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
      <RetailBackofficeShell>
        <RetailBackofficeMain>
          <p className="text-sm text-slate-600">Loading low stock report…</p>
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  if (error || !hasAccess) {
    return (
      <RetailBackofficeShell>
        <RetailBackofficeMain>
          <RetailBackofficeAlert tone="error" className="mb-4">
            {error || "Access denied"}
          </RetailBackofficeAlert>
          <RetailBackofficeButton variant="secondary" onClick={() => router.push(retailPaths.dashboard)}>
            Back to dashboard
          </RetailBackofficeButton>
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain>
        <RetailBackofficeBackLink onClick={() => router.push(retailPaths.dashboard)}>Back to dashboard</RetailBackofficeBackLink>

        <RetailBackofficePageHeader
          eyebrow="Product & inventory"
          title="Low stock"
          description="Tracked products at or below their threshold. Restock or adjust thresholds from the product record."
        />

        {products.length === 0 ? (
          <RetailBackofficeEmpty
            title="Nothing needs attention"
            description="No tracked products are below threshold or out of stock for the current store context."
          />
        ) : (
          <>
            <RetailBackofficeCard padding="p-0" className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead className="border-b border-slate-100 bg-slate-50/80">
                    <tr>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Product
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Barcode
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        On hand
                      </th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Status
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Threshold
                      </th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {products.map((product) => (
                      <tr
                        key={product.variant_id ? `${product.id}-${product.variant_id}` : product.id}
                        className="transition-colors hover:bg-slate-50/60"
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-slate-900">
                          {product.variant_name
                            ? `${product.name} · ${product.variant_name}`
                            : product.name}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">{product.barcode || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums font-semibold text-slate-900">
                          {product.currentStock}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-center text-sm">
                          {product.status === "out_of_stock" ? (
                            <RetailBackofficeBadge tone="danger">Out</RetailBackofficeBadge>
                          ) : (
                            <RetailBackofficeBadge tone="warning">Low</RetailBackofficeBadge>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums text-slate-600">
                          {product.threshold}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-center text-sm">
                          <RetailBackofficeButton
                            variant="ghost"
                            className="text-xs"
                            onClick={() => router.push(retailPaths.productEdit(product.id))}
                          >
                            Edit product
                          </RetailBackofficeButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </RetailBackofficeCard>

            <RetailBackofficeCard className="mt-6" padding="p-4 sm:p-5">
              <RetailBackofficeCardTitle className="mb-2">Summary</RetailBackofficeCardTitle>
              <p className="text-sm text-slate-600">
                <span className="font-medium text-slate-900">{products.length}</span> items need attention ·{" "}
                <span className="font-medium text-rose-900">
                  {products.filter((p) => p.status === "out_of_stock").length}
                </span>{" "}
                out ·{" "}
                <span className="font-medium text-amber-950">
                  {products.filter((p) => p.status === "low_stock").length}
                </span>{" "}
                low
              </p>
            </RetailBackofficeCard>
          </>
        )}
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}

