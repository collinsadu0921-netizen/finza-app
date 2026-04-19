"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { getActiveStoreId } from "@/lib/storeSession"
import { retailPaths } from "@/lib/retail/routes"
import type { RetailLowStockRow } from "@/lib/retail/purchaseOrdersLowStock"
import {
  RetailBackofficeAlert,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeCardTitle,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeSectionTitle,
  RetailBackofficeShell,
  retailFieldClass,
  retailLabelClass,
  RetailMenuSelect,
  type MenuSelectOption,
} from "@/components/retail/RetailBackofficeUi"

type Supplier = { id: string; name: string }
type Product = { id: string; name: string; price: number | null }
type StoreRow = { id: string; name: string }

type Line = {
  key: string
  product_id: string | null
  variant_id: string | null
  quantity: number
  unit_cost: string
}

export default function NewBuyListPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [stores, setStores] = useState<StoreRow[]>([])
  const [lowStock, setLowStock] = useState<RetailLowStockRow[]>([])
  const [lowStockStoreId, setLowStockStoreId] = useState<string>("")
  const [supplierId, setSupplierId] = useState(searchParams.get("supplier_id") || "")
  const [reference, setReference] = useState("")
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split("T")[0])
  const [expectedDate, setExpectedDate] = useState("")
  const [supplierOrderNote, setSupplierOrderNote] = useState("")
  const [lines, setLines] = useState<Line[]>([
    { key: crypto.randomUUID(), product_id: null, variant_id: null, quantity: 1, unit_cost: "" },
  ])

  const supplierMenuOptions = useMemo(() => {
    const head: MenuSelectOption[] = [{ value: "", label: "Select supplier" }]
    return head.concat(suppliers.map((s) => ({ value: s.id, label: s.name })))
  }, [suppliers])

  const lowStockStoreMenuOptions = useMemo(
    () => stores.map((s) => ({ value: s.id, label: s.name })),
    [stores],
  )

  const lineProductMenuOptions = useMemo(() => {
    const head: MenuSelectOption[] = [{ value: "", label: "Select" }]
    return head.concat(products.map((p) => ({ value: p.id, label: p.name })))
  }, [products])

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    if (!lowStockStoreId) return
    void loadLowStock(lowStockStoreId)
  }, [lowStockStoreId])

  const loadData = async () => {
    try {
      setLoading(true)
      setError("")
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setError("You must be logged in")
        setLoading(false)
        return
      }
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }

      const { data: suppliersData, error: suppliersError } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("business_id", business.id)
        .eq("status", "active")
        .order("name", { ascending: true })

      if (suppliersError) throw new Error(suppliersError.message || "Failed to load suppliers")
      setSuppliers(suppliersData || [])

      const { data: productsData, error: productsError } = await supabase
        .from("products")
        .select("id, name, price")
        .eq("business_id", business.id)
        .order("name", { ascending: true })

      if (productsError) throw new Error(productsError.message || "Failed to load products")
      setProducts((productsData || []) as Product[])

      const { data: storesData, error: storesError } = await supabase
        .from("stores")
        .select("id, name")
        .eq("business_id", business.id)
        .order("name", { ascending: true })

      if (!storesError && storesData?.length) {
        setStores(storesData as StoreRow[])
        const active = getActiveStoreId()
        const pick =
          active && active !== "all" && storesData.some((s: StoreRow) => s.id === active)
            ? active
            : (storesData[0] as StoreRow).id
        setLowStockStoreId(pick)
      }

      setLoading(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load")
      setLoading(false)
    }
  }

  const loadLowStock = async (storeId: string) => {
    try {
      const qs = new URLSearchParams({ store_id: storeId })
      const res = await fetch(`${retailPaths.apiPurchaseOrdersLowStock}?${qs}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Low stock failed")
      setLowStock(data.items || [])
    } catch {
      setLowStock([])
    }
  }

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { key: crypto.randomUUID(), product_id: null, variant_id: null, quantity: 1, unit_cost: "" },
    ])
  }

  const removeLine = (key: string) => {
    if (lines.length <= 1) {
      setError("Add at least one product line.")
      return
    }
    setLines((prev) => prev.filter((l) => l.key !== key))
    setError("")
  }

  const updateLine = (key: string, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  const addLowStockProduct = (row: RetailLowStockRow) => {
    const rowVariant = row.variant_id ?? null
    const exists = lines.some(
      (l) => l.product_id === row.product_id && (l.variant_id || null) === rowVariant
    )
    if (exists) {
      setLines((prev) =>
        prev.map((l) =>
          l.product_id === row.product_id && (l.variant_id || null) === rowVariant
            ? { ...l, quantity: l.quantity + row.suggested_order_qty }
            : l
        )
      )
      return
    }
    setLines((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        product_id: row.product_id,
        variant_id: rowVariant,
        quantity: row.suggested_order_qty,
        unit_cost: "",
      },
    ])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (!supplierId) {
      setError("Choose a supplier.")
      return
    }
    const payloadItems: Array<{
      product_id: string
      variant_id: string | null
      quantity: number
      unit_cost: number | null
    }> = []
    for (const l of lines) {
      if (!l.product_id || l.quantity <= 0) continue
      const uc = l.unit_cost.trim() === "" ? null : Number(l.unit_cost)
      if (uc != null && (Number.isNaN(uc) || uc < 0)) {
        setError("Optional costs must be numbers ≥ 0.")
        setSubmitting(false)
        return
      }
      payloadItems.push({
        product_id: l.product_id,
        variant_id: l.variant_id ?? null,
        quantity: Number(l.quantity),
        unit_cost: uc,
      })
    }

    if (payloadItems.length === 0) {
      setError("Add at least one product with quantity.")
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: supplierId,
          reference: reference.trim() || null,
          order_date: orderDate,
          expected_date: expectedDate || null,
          supplier_order_note: supplierOrderNote.trim() || null,
          items: payloadItems,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to create buy list")
      const id = data.purchase_order?.id as string | undefined
      router.push(id ? `/retail/admin/purchase-orders/${id}` : "/retail/admin/purchase-orders")
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <RetailBackofficeShell>
        <RetailBackofficeMain className="max-w-4xl">
          <p className="text-sm text-slate-600">Loading…</p>
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain className="max-w-4xl">
        <RetailBackofficePageHeader
          eyebrow="Procurement"
          title="New buy list"
          description="List what you need and quantities. You can send without prices — enter real costs when goods arrive."
        />

        {error ? (
          <RetailBackofficeAlert tone="error" className="mb-4">
            {error}
          </RetailBackofficeAlert>
        ) : null}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
          <RetailBackofficeCard>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={retailLabelClass}>Supplier *</label>
                <RetailMenuSelect
                  value={supplierId}
                  onValueChange={setSupplierId}
                  disabled={submitting}
                  options={supplierMenuOptions}
                />
              </div>
              <div>
                <label className={retailLabelClass}>Your reference (optional)</label>
                <input className={retailFieldClass} value={reference} onChange={(e) => setReference(e.target.value)} disabled={submitting} />
              </div>
              <div>
                <label className={retailLabelClass}>Date</label>
                <input type="date" className={retailFieldClass} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} disabled={submitting} />
              </div>
              <div>
                <label className={retailLabelClass}>Expected (optional)</label>
                <input type="date" className={retailFieldClass} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} disabled={submitting} />
              </div>
              <div className="sm:col-span-2">
                <label className={retailLabelClass}>Note for supplier (optional)</label>
                <textarea
                  className={retailFieldClass}
                  rows={2}
                  value={supplierOrderNote}
                  onChange={(e) => setSupplierOrderNote(e.target.value)}
                  placeholder="e.g. Deliver to back entrance Saturday morning"
                  disabled={submitting}
                />
              </div>
            </div>
          </RetailBackofficeCard>

          {stores.length > 0 ? (
            <RetailBackofficeCard>
              <RetailBackofficeCardTitle>Low stock — quick add</RetailBackofficeCardTitle>
              <p className="mt-1 text-xs text-slate-500">
                Choose which store shelf you are buying for. Suggested qty is a rough restock hint, not a forecast.
              </p>
              <div className="mt-4 max-w-md">
                <label className={retailLabelClass}>Store for low-stock view</label>
                <RetailMenuSelect
                  value={lowStockStoreId}
                  onValueChange={setLowStockStoreId}
                  disabled={submitting}
                  options={lowStockStoreMenuOptions}
                />
              </div>
              {lowStock.length === 0 ? (
                <p className="mt-4 text-sm text-slate-600">Nothing low for this store right now.</p>
              ) : (
                <div className="mt-4 max-h-56 space-y-2 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                  {lowStock.map((row) => (
                    <div
                      key={`${row.product_id}-${row.variant_id ?? "base"}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm shadow-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-900">{row.name}</div>
                        <div className="text-xs text-slate-500">
                          Stock {row.current_stock} · threshold {row.threshold} · suggest {row.suggested_order_qty}
                        </div>
                      </div>
                      <RetailBackofficeButton type="button" variant="secondary" onClick={() => addLowStockProduct(row)} disabled={submitting}>
                        Add
                      </RetailBackofficeButton>
                    </div>
                  ))}
                </div>
              )}
            </RetailBackofficeCard>
          ) : null}

          <RetailBackofficeCard>
            <RetailBackofficeSectionTitle>Lines</RetailBackofficeSectionTitle>
            <p className="mb-4 text-xs text-slate-500">Quantity required. Unit cost is optional (estimate only).</p>
            <div className="space-y-3">
              {lines.map((item) => (
                <div key={item.key} className="grid grid-cols-12 gap-2 border-b border-slate-100 pb-3">
                  <div className="col-span-12 sm:col-span-5">
                    <label className={retailLabelClass}>Product</label>
                    <RetailMenuSelect
                      value={item.product_id || ""}
                      onValueChange={(v) =>
                        updateLine(item.key, { product_id: v || null, variant_id: null })
                      }
                      disabled={submitting}
                      options={lineProductMenuOptions}
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <label className={retailLabelClass}>Qty</label>
                    <input
                      type="number"
                      min={1}
                      className={retailFieldClass}
                      value={item.quantity}
                      onChange={(e) => updateLine(item.key, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                      disabled={submitting}
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <label className={retailLabelClass}>Est. unit cost (optional)</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className={retailFieldClass}
                      value={item.unit_cost}
                      onChange={(e) => updateLine(item.key, { unit_cost: e.target.value })}
                      placeholder="—"
                      disabled={submitting}
                    />
                  </div>
                  <div className="col-span-2 flex items-end sm:col-span-2">
                    <RetailBackofficeButton type="button" variant="ghost" onClick={() => removeLine(item.key)} disabled={submitting || lines.length <= 1}>
                      Remove
                    </RetailBackofficeButton>
                  </div>
                </div>
              ))}
            </div>
            <RetailBackofficeButton type="button" variant="secondary" className="mt-4" onClick={addLine} disabled={submitting}>
              + Add line
            </RetailBackofficeButton>
          </RetailBackofficeCard>

          <div className="flex flex-wrap gap-3">
            <RetailBackofficeButton type="button" variant="secondary" onClick={() => router.push("/retail/admin/purchase-orders")} disabled={submitting}>
              Cancel
            </RetailBackofficeButton>
            <RetailBackofficeButton type="submit" variant="primary" disabled={submitting}>
              {submitting ? "Saving…" : "Save buy list"}
            </RetailBackofficeButton>
          </div>
        </form>
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}
