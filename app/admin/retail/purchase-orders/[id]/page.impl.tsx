"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { getActiveStoreId, getActiveStoreName, setActiveStoreId } from "@/lib/storeSession"
import { formatMoney } from "@/lib/money"
import {
  BUY_LIST_TEMPLATE_IDS,
  buildBuyListMessage,
  buildMailtoBuyListUrl,
  buildWhatsAppBuyListUrl,
  buyListTemplateLabel,
  normalizePhoneForWa,
  type BuyListTemplateId,
} from "@/lib/retail/buildSupplierBuyListMessages"
import {
  purchaseOrderStatusBadgeTone,
  purchaseOrderStatusLabel,
} from "@/lib/retail/purchaseOrderStatusLabels"
import {
  RetailBackofficeAlert,
  RetailBackofficeBadge,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeCardTitle,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
  retailFieldClass,
  retailLabelClass,
  RetailMenuSelect,
} from "@/components/retail/RetailBackofficeUi"

type PoItem = {
  id: string
  product_id: string
  variant_id: string | null
  quantity: number
  quantity_received?: number | null
  unit_cost: number | null
  total_cost: number | null
  received_unit_cost: number | null
  product?: { id: string; name: string; price?: number | null }
}

type PurchaseOrder = {
  id: string
  status: string
  payment_state?: string
  reference: string | null
  order_date: string
  expected_date?: string | null
  supplier_order_note?: string | null
  supplier: { id: string; name: string; phone?: string | null; email?: string | null }
  items: PoItem[]
}

type StoreRow = { id: string; name: string }

export default function BuyListDetailPage() {
  const params = useParams()
  const router = useRouter()
  const poId = params.id as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [po, setPo] = useState<PurchaseOrder | null>(null)
  const [currencyCode, setCurrencyCode] = useState("GHS")
  const [businessName, setBusinessName] = useState("")
  const [stores, setStores] = useState<StoreRow[]>([])
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [receiveStoreId, setReceiveStoreId] = useState("")
  const [activeStoreId, setActiveStoreIdState] = useState<string | null>(null)
  const [activeStoreName, setActiveStoreName] = useState<string | null>(null)
  const [receiveLines, setReceiveLines] = useState<Record<string, { qty: string; cost: string }>>({})
  const [actionBusy, setActionBusy] = useState(false)
  const [listTemplate, setListTemplate] = useState<BuyListTemplateId>("default")
  const [noteDraft, setNoteDraft] = useState("")
  const [copyFeedback, setCopyFeedback] = useState(false)
  const [savingNote, setSavingNote] = useState(false)

  const receiveStoreMenuOptions = useMemo(
    () => stores.map((s) => ({ value: s.id, label: s.name })),
    [stores],
  )

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError("")
      const res = await fetch(`/api/purchase-orders/${poId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Not found")
      setPo(data.purchase_order as PurchaseOrder)

      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        const biz = await getCurrentBusiness(supabase, user.id)
        if (biz) {
          setBusinessName(biz.name || "Store")
          setCurrencyCode(biz.default_currency || "GHS")
          const { data: st } = await supabase.from("stores").select("id, name").eq("business_id", biz.id).order("name")
          if (st?.length) {
            setStores(st as StoreRow[])
            const sessionStoreId = getActiveStoreId()
            const sessionStoreName = getActiveStoreName()
            const validSessionStore = sessionStoreId && st.some((store: { id: string }) => store.id === sessionStoreId)

            setActiveStoreIdState(validSessionStore ? sessionStoreId : null)
            setActiveStoreName(validSessionStore ? sessionStoreName : null)
            setReceiveStoreId(validSessionStore ? sessionStoreId : "")
          }
        }
      }

      const p = data.purchase_order as PurchaseOrder
      const init: Record<string, { qty: string; cost: string }> = {}
      for (const it of p.items || []) {
        const ordered = Number(it.quantity)
        const already = Number(it.quantity_received ?? 0)
        init[it.id] = {
          qty: String(already > 0 ? already : ordered),
          cost: it.received_unit_cost != null ? String(it.received_unit_cost) : "",
        }
      }
      setReceiveLines(init)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load")
      setPo(null)
    } finally {
      setLoading(false)
    }
  }, [poId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (po) setNoteDraft(po.supplier_order_note ?? "")
  }, [po?.id, po?.supplier_order_note])

  useEffect(() => {
    try {
      const v = localStorage.getItem("finza-buy-list-template")
      if (v && (BUY_LIST_TEMPLATE_IDS as readonly string[]).includes(v)) {
        setListTemplate(v as BuyListTemplateId)
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem("finza-buy-list-template", listTemplate)
    } catch {
      /* ignore */
    }
  }, [listTemplate])

  useEffect(() => {
    if (loading || !po) return
    if (typeof window === "undefined") return
    if (window.location.hash !== "#send-to-supplier") return
    requestAnimationFrame(() => {
      document.getElementById("send-to-supplier")?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  }, [loading, po?.id])

  const listPayload = useMemo(() => {
    if (!po) return null
    return {
      businessName,
      supplierName: po.supplier.name,
      reference: po.reference,
      orderDate: po.order_date,
      expectedDate: po.expected_date ?? null,
      lines: (po.items || []).map((it) => ({
        productName: it.product?.name || "Product",
        quantity: Number(it.quantity),
      })),
      supplierNote: noteDraft.trim() ? noteDraft.trim() : null,
    }
  }, [po, businessName, noteDraft])

  const listMessageBody = useMemo(() => {
    if (!listPayload) return ""
    return buildBuyListMessage(listTemplate, listPayload)
  }, [listTemplate, listPayload])

  const waHref = useMemo(() => {
    if (!po) return null
    const digits = normalizePhoneForWa(po.supplier.phone || undefined)
    if (!digits) return null
    return buildWhatsAppBuyListUrl(digits, listMessageBody)
  }, [po, listMessageBody])

  const mailHref = useMemo(() => {
    if (!po?.supplier.email?.trim()) return null
    const subj = `Order — ${po.reference || po.id.slice(0, 8)} — ${businessName}`
    return buildMailtoBuyListUrl(po.supplier.email, subj, listMessageBody)
  }, [po, listMessageBody, businessName])

  const templateMenuOptions = useMemo(
    () => BUY_LIST_TEMPLATE_IDS.map((id) => ({ value: id, label: buyListTemplateLabel(id) })),
    [],
  )

  const noteDirty = po != null && noteDraft !== (po.supplier_order_note ?? "")

  const saveSupplierNote = async () => {
    if (!po) return
    setSavingNote(true)
    setError("")
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplier_order_note: noteDraft.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to save note")
      const updated = data.purchase_order as { supplier_order_note?: string | null } | undefined
      if (updated && "supplier_order_note" in updated) {
        setPo((prev) =>
          prev ? { ...prev, supplier_order_note: updated.supplier_order_note ?? null } : null,
        )
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save note")
    } finally {
      setSavingNote(false)
    }
  }

  const copyListToClipboard = async () => {
    if (!listMessageBody) return
    try {
      await navigator.clipboard.writeText(listMessageBody)
      setCopyFeedback(true)
      window.setTimeout(() => setCopyFeedback(false), 2000)
    } catch {
      setError("Could not copy — check browser permissions.")
    }
  }

  const markOrdered = async () => {
    if (!po) return
    setActionBusy(true)
    setError("")
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}/send`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed")
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed")
    } finally {
      setActionBusy(false)
    }
  }

  const cancelBuyList = async () => {
    if (!po || !confirm("Cancel this buy list?")) return
    setActionBusy(true)
    setError("")
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed")
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed")
    } finally {
      setActionBusy(false)
    }
  }

  const patchPayment = async (payment_state: string) => {
    if (!po) return
    setActionBusy(true)
    setError("")
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_state }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed")
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed")
    } finally {
      setActionBusy(false)
    }
  }

  const submitReceive = async () => {
    if (!po || !receiveStoreId) {
      setError("Choose a store to receive into.")
      return
    }
    if (!activeStoreId) {
      setError("No active store selected. Open a store first so receive and sales stay in the same store context.")
      return
    }
    if (receiveStoreId !== activeStoreId) {
      const selectedStore = stores.find((s) => s.id === receiveStoreId)
      const proceed = window.confirm(
        `You are receiving into "${selectedStore?.name || "selected store"}" while active store is "${activeStoreName || "another store"}".\n\nContinue?`
      )
      if (!proceed) return
    }
    const lines = po.items.map((it) => {
      const row = receiveLines[it.id] || { qty: "0", cost: "" }
      const q = Number(row.qty)
      const c = Number(row.cost)
      return { id: it.id, quantity_received: q, received_unit_cost: c }
    })
    setActionBusy(true)
    setError("")
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store_id: receiveStoreId, lines }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Receive failed")
      setReceiveOpen(false)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Receive failed")
    } finally {
      setActionBusy(false)
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

  if (error && !po) {
    return (
      <RetailBackofficeShell>
        <RetailBackofficeMain className="max-w-4xl">
          <RetailBackofficeAlert tone="error">{error}</RetailBackofficeAlert>
          <RetailBackofficeButton variant="secondary" className="mt-4" type="button" onClick={() => router.push("/retail/admin/purchase-orders")}>
            Back
          </RetailBackofficeButton>
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  if (!po) return null

  const canSend = po.status === "planned"
  const canReceive = po.status === "ordered" || po.status === "partially_received"
  const canCancel = !["received", "paid", "cancelled"].includes(po.status)

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain className="max-w-4xl">
        <button
          type="button"
          onClick={() => router.push("/retail/admin/purchase-orders")}
          className="mb-6 text-sm font-medium text-slate-500 hover:text-slate-900"
        >
          ← Buy lists
        </button>

        <RetailBackofficePageHeader
          eyebrow="Supplier order"
          title={po.reference || `Buy list ${po.id.slice(0, 8)}`}
          description="Share the list, then record what arrived and what you actually paid per unit. Stock updates on receive; accounts post when the receipt is complete."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/retail/admin/suppliers/${po.supplier.id}`}
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
              >
                Supplier profile
              </Link>
            </div>
          }
        />

        {error ? <RetailBackofficeAlert tone="error" className="mb-4">{error}</RetailBackofficeAlert> : null}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <RetailBackofficeBadge tone={purchaseOrderStatusBadgeTone(po.status)}>{purchaseOrderStatusLabel(po.status)}</RetailBackofficeBadge>
          <RetailBackofficeBadge tone="neutral">Pay: {po.payment_state || "unpaid"}</RetailBackofficeBadge>
          <RetailBackofficeBadge tone={activeStoreId ? "info" : "warning"}>
            Active store: {activeStoreName || "Not selected"}
          </RetailBackofficeBadge>
        </div>

        <div id="send-to-supplier" className="scroll-mt-4">
          <RetailBackofficeCard className="mb-6">
            <RetailBackofficeCardTitle>Send to supplier</RetailBackofficeCardTitle>
            <p className="mt-1 text-xs text-slate-500">
              {canSend
                ? "Choose a list template, copy or open WhatsApp / email, then mark as ordered when the supplier has your list."
                : "This buy list is already marked sent or past that stage. You can still copy the message for your records."}
            </p>

            <div className="mt-4 space-y-4">
              <div>
                <label className={retailLabelClass}>List template</label>
                <RetailMenuSelect
                  value={listTemplate}
                  onValueChange={(v) => setListTemplate(v as BuyListTemplateId)}
                  options={templateMenuOptions}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Standard is polite prose; Short is compact for SMS-style paste; Detailed includes order and expected dates.
                </p>
              </div>

              <div>
                <label className={retailLabelClass}>Note to supplier (included in the list)</label>
                <textarea
                  className={`${retailFieldClass} min-h-[72px] resize-y`}
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="e.g. Deliver to back entrance, call before arrival…"
                  rows={3}
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <RetailBackofficeButton
                    type="button"
                    variant="secondary"
                    disabled={!noteDirty || savingNote}
                    onClick={() => void saveSupplierNote()}
                  >
                    {savingNote ? "Saving…" : "Save note"}
                  </RetailBackofficeButton>
                  {noteDirty ? <span className="text-xs text-amber-800">Unsaved — save so WhatsApp / email uses this note.</span> : null}
                </div>
              </div>

              <div>
                <label className={retailLabelClass}>Preview (what you send)</label>
                <textarea
                  readOnly
                  className={`${retailFieldClass} min-h-[200px] resize-y font-mono text-xs leading-relaxed text-slate-800`}
                  value={listMessageBody}
                  rows={12}
                  aria-label="Buy list message preview"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <RetailBackofficeButton type="button" variant="secondary" onClick={() => void copyListToClipboard()}>
                    Copy full list
                  </RetailBackofficeButton>
                  {copyFeedback ? (
                    <span className="text-xs font-medium text-emerald-700">Copied to clipboard.</span>
                  ) : null}
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Open in app</p>
                <div className="flex flex-wrap gap-2">
                  {waHref ? (
                    <a
                      href={waHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
                    >
                      WhatsApp
                    </a>
                  ) : (
                    <span className="text-xs text-slate-500">Add a phone number on the supplier to use WhatsApp.</span>
                  )}
                  {mailHref ? (
                    <a
                      href={mailHref}
                      className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                    >
                      Email
                    </a>
                  ) : (
                    <span className="text-xs text-slate-500">Add supplier email for mail.</span>
                  )}
                </div>
              </div>

              {canSend ? (
                <div className="border-t border-slate-100 pt-4">
                  <p className="mb-2 text-xs text-slate-600">
                    After you have sent the list (any channel), confirm here so you can record deliveries.
                  </p>
                  <RetailBackofficeButton type="button" variant="primary" disabled={actionBusy} onClick={() => void markOrdered()}>
                    Mark as ordered (sent)
                  </RetailBackofficeButton>
                </div>
              ) : null}
            </div>
          </RetailBackofficeCard>
        </div>

        <RetailBackofficeCard className="mb-6">
          <RetailBackofficeCardTitle>Lines</RetailBackofficeCardTitle>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase text-slate-500">
                  <th className="py-2 pr-4">Product</th>
                  <th className="py-2 pr-4">Ordered</th>
                  <th className="py-2 pr-4">Received</th>
                  <th className="py-2 pr-4">Est. unit</th>
                  <th className="py-2">Actual unit</th>
                </tr>
              </thead>
              <tbody>
                {po.items.map((it) => (
                  <tr key={it.id} className="border-b border-slate-50">
                    <td className="py-2 pr-4 font-medium text-slate-900">{it.product?.name || "—"}</td>
                    <td className="py-2 pr-4">{it.quantity}</td>
                    <td className="py-2 pr-4">{it.quantity_received ?? 0}</td>
                    <td className="py-2 pr-4 text-slate-600">{it.unit_cost != null ? formatMoney(Number(it.unit_cost), currencyCode) : "—"}</td>
                    <td className="py-2 text-slate-600">
                      {it.received_unit_cost != null ? formatMoney(Number(it.received_unit_cost), currencyCode) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </RetailBackofficeCard>

        <div className="mb-6 flex flex-wrap gap-2">
          {canReceive ? (
            <RetailBackofficeButton type="button" variant="primary" onClick={() => setReceiveOpen(true)} disabled={actionBusy}>
              Record delivery / receive
            </RetailBackofficeButton>
          ) : null}
          {canCancel ? (
            <RetailBackofficeButton type="button" variant="danger" onClick={() => void cancelBuyList()} disabled={actionBusy}>
              Cancel buy list
            </RetailBackofficeButton>
          ) : null}
        </div>

        <RetailBackofficeCard className="mb-6">
          <RetailBackofficeCardTitle>Supplier payment (simple)</RetailBackofficeCardTitle>
          <p className="mt-1 text-xs text-slate-500">Track whether you have paid the supplier — no bank journal from this screen.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["unpaid", "part_paid", "paid"] as const).map((p) => (
              <RetailBackofficeButton key={p} variant="secondary" type="button" disabled={actionBusy} onClick={() => void patchPayment(p)}>
                {p.replace("_", " ")}
              </RetailBackofficeButton>
            ))}
          </div>
        </RetailBackofficeCard>

        {receiveOpen ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-slate-900">Receive goods</h3>
              <p className="mt-1 text-xs text-slate-500">
                Enter total quantity you have received for each line so far (usually equals ordered after one delivery) and the actual unit cost you agreed. When every line matches the order with costs entered, stock and supplier payable are posted.
              </p>
              <div className="mt-4">
                <label className={retailLabelClass}>Store *</label>
                <RetailMenuSelect
                  value={receiveStoreId}
                  onValueChange={setReceiveStoreId}
                  options={receiveStoreMenuOptions}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Receiving store:{" "}
                  <span className="font-semibold">
                    {stores.find((s) => s.id === receiveStoreId)?.name || "Not selected"}
                  </span>
                </p>
                {activeStoreId ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Active store context: <span className="font-semibold">{activeStoreName || activeStoreId}</span>
                    {receiveStoreId && receiveStoreId !== activeStoreId ? (
                      <span className="ml-1 text-amber-700">- different from receiving store (confirmation required)</span>
                    ) : null}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-amber-700">
                    No active store selected. Open a store first (Stores - Open Store), or select one now:
                    <button
                      type="button"
                      className="ml-1 underline"
                      onClick={() => {
                        const selected = stores.find((s) => s.id === receiveStoreId)
                        if (!selected) return
                        setActiveStoreId(selected.id, selected.name)
                        setActiveStoreIdState(selected.id)
                        setActiveStoreName(selected.name)
                      }}
                    >
                      Set active store to receiving store
                    </button>
                  </p>
                )}
              </div>
              <div className="mt-4 space-y-3">
                {po.items.map((it) => (
                  <div key={it.id} className="rounded-xl border border-slate-100 p-3">
                    <div className="font-medium text-slate-900">{it.product?.name}</div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <label className={retailLabelClass}>Total received qty</label>
                        <input
                          className={retailFieldClass}
                          value={receiveLines[it.id]?.qty ?? ""}
                          onChange={(e) =>
                            setReceiveLines((prev) => ({
                              ...prev,
                              [it.id]: { ...prev[it.id], qty: e.target.value, cost: prev[it.id]?.cost ?? "" },
                            }))
                          }
                        />
                      </div>
                      <div>
                        <label className={retailLabelClass}>Actual unit cost</label>
                        <input
                          className={retailFieldClass}
                          value={receiveLines[it.id]?.cost ?? ""}
                          onChange={(e) =>
                            setReceiveLines((prev) => ({
                              ...prev,
                              [it.id]: { qty: prev[it.id]?.qty ?? "", cost: e.target.value },
                            }))
                          }
                        />
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">Ordered: {it.quantity} · already in: {it.quantity_received ?? 0}</div>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <RetailBackofficeButton type="button" variant="ghost" onClick={() => setReceiveOpen(false)}>
                  Close
                </RetailBackofficeButton>
                <RetailBackofficeButton type="button" variant="primary" disabled={actionBusy} onClick={() => void submitReceive()}>
                  Save receipt
                </RetailBackofficeButton>
              </div>
            </div>
          </div>
        ) : null}
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}
