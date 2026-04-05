"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { getCanonicalTaxResultFromLineItems, deriveLegacyTaxColumnsFromTaxLines } from "@/lib/taxEngine/helpers"
import { normalizeCountry } from "@/lib/payments/eligibility"

type InvoiceItem = {
  id: string
  description: string
  qty: number
  unit_price: number
  discount_amount: number
  line_subtotal: number
}

type LineItem = {
  id: string
  invoice_item_id: string | null
  description: string
  qty: number
  unit_price: number
  discount_type: "amount" | "percent"
  discount_value: number
  /** Persisted/legacy amount stored on credit_note_items. Derived from discount_type/value in the UI. */
  discount_amount: number
  _rawDiscount?: string
}

const round2 = (value: number): number => Math.round((value || 0) * 100) / 100

const getDiscountAmount = (item: Pick<LineItem, "qty" | "unit_price" | "discount_type" | "discount_value">): number => {
  const gross = Math.max(0, (Number(item.qty) || 0) * (Number(item.unit_price) || 0))
  const rawDiscount = Number(item.discount_value) || 0
  if (rawDiscount <= 0 || gross <= 0) return 0

  const discount = item.discount_type === "percent"
    ? (gross * Math.min(100, Math.max(0, rawDiscount))) / 100
    : Math.max(0, rawDiscount)

  return round2(Math.min(discount, gross))
}

import { Suspense } from "react"

function CreateCreditNoteContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const invoiceId = searchParams.get("invoiceId")

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [invoice, setInvoice] = useState<any>(null)
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([])
  const [creditNotes, setCreditNotes] = useState<Array<{ total?: number; status?: string }>>([])
  const [jurisdiction, setJurisdiction] = useState<string>("GH")
  const [items, setItems] = useState<LineItem[]>([])
  const [date, setDate] = useState(new Date().toISOString().split("T")[0])
  const [reason, setReason] = useState("")
  const [notes, setNotes] = useState("")
  const [applyTaxes, setApplyTaxes] = useState(true)
  const [showInvoicePicker, setShowInvoicePicker] = useState(false)
  const [invoiceList, setInvoiceList] = useState<Array<{ id: string; invoice_number: string; total: number; status: string; customers?: { name: string } | null }>>([])
  const [loadingInvoices, setLoadingInvoices] = useState(false)

  const STORAGE_KEY = "credit_note_create_invoice_id"

  useEffect(() => {
    const paramId = searchParams.get("invoiceId")
    if (paramId) {
      try {
        sessionStorage.setItem(STORAGE_KEY, paramId)
      } catch {
        /* ignore */
      }
      loadInvoiceData(paramId)
      return
    }
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY)
      if (stored) {
        router.replace(`/credit-notes/create?invoiceId=${encodeURIComponent(stored)}`)
        setLoading(false)
        return
      }
    } catch {
      /* ignore */
    }
    setShowInvoicePicker(true)
    setLoading(false)
  }, [searchParams])

  useEffect(() => {
    if (!showInvoicePicker) return
    let cancelled = false
    async function fetchInvoices() {
      setLoadingInvoices(true)
      try {
        const r = await fetch("/api/invoices/list")
        if (cancelled) return
        if (!r.ok) {
          setInvoiceList([])
          return
        }
        const data = await r.json()
        const list = (data.invoices || []).filter(
          (inv: { status: string }) => ["sent", "paid", "partially_paid", "overdue"].includes(inv.status)
        )
        setInvoiceList(list)
      } catch {
        if (!cancelled) setInvoiceList([])
      } finally {
        if (!cancelled) setLoadingInvoices(false)
      }
    }
    fetchInvoices()
    return () => { cancelled = true }
  }, [showInvoicePicker])

  const loadInvoiceData = async (id?: string) => {
    const invoiceIdToLoad = id ?? searchParams.get("invoiceId")
    if (!invoiceIdToLoad) return
    try {
      setLoading(true)
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Not authenticated")
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }

      setBusinessId(business.id)
      const code = normalizeCountry(business?.address_country)
      setJurisdiction(code && typeof code === "string" ? code : "GH")

      // Load invoice
      const response = await fetch(`/api/invoices/${invoiceIdToLoad}`)
      if (!response.ok) {
        throw new Error("Failed to load invoice")
      }

      const data = await response.json()
      setInvoice(data.invoice)
      setInvoiceItems(data.items || [])
      setCreditNotes(data.creditNotes ?? [])

      // Prefill items from invoice
      if (data.items && data.items.length > 0) {
        setItems(
          data.items.map((item: InvoiceItem) => ({
            id: Date.now().toString() + Math.random(),
            invoice_item_id: item.id,
            description: item.description,
            qty: item.qty,
            unit_price: item.unit_price,
            discount_type: "amount",
            discount_value: item.discount_amount || 0,
            discount_amount: item.discount_amount || 0,
          }))
        )
      }

      setApplyTaxes(data.invoice.apply_taxes !== false)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load invoice")
      setLoading(false)
    }
  }

  const addItem = () => {
    setItems([
      ...items,
      {
        id: Date.now().toString(),
        invoice_item_id: null,
        description: "",
        qty: 0,
        unit_price: 0,
        discount_type: "amount",
        discount_value: 0,
        discount_amount: 0,
      },
    ])
  }

  const removeItem = (id: string) => {
    setItems(items.filter((item) => item.id !== id))
  }

  const updateItem = (id: string, field: keyof LineItem, value: any) => {
    setItems(
      items.map((item) => {
        if (item.id === id) {
          const updated: any = { ...item, [field]: value }
          if (field === "_rawDiscount") return updated
          if (field === "qty" || field === "unit_price" || field === "discount_value" || field === "discount_type") {
            if (field === "discount_value") updated._rawDiscount = String(value)
            updated.discount_amount = getDiscountAmount(updated)
          }
          return updated
        }
        return item
      })
    )
  }

  // Canonical tax calculation: same as backend credit-notes/create (taxInclusive, Ghana engine)
  const effectiveDate = date.split("T")[0]
  const lineItems = items.map((item) => ({
    quantity: Number(item.qty) || 0,
    unit_price: Number(item.unit_price) || 0,
    discount_amount: getDiscountAmount(item),
  }))
  const totalDiscount = items.reduce((sum, item) => sum + getDiscountAmount(item), 0)

  const taxResult = (() => {
    if (applyTaxes && lineItems.length > 0) {
      const canonical = getCanonicalTaxResultFromLineItems(lineItems, {
        jurisdiction,
        effectiveDate,
        taxInclusive: true,
      })
      const legacy = deriveLegacyTaxColumnsFromTaxLines(canonical.lines)
      return {
        subtotalBeforeTax: canonical.base_amount,
        nhil: legacy.nhil,
        getfund: legacy.getfund,
        vat: legacy.vat,
        totalTax: canonical.total_tax,
        grandTotal: canonical.total_amount,
      }
    }
    const subtotal = lineItems.reduce((sum, item) => {
      const lineTotal = item.quantity * item.unit_price
      const discount = item.discount_amount || 0
      return sum + lineTotal - discount
    }, 0)
    return {
      subtotalBeforeTax: subtotal,
      nhil: 0,
      getfund: 0,
      vat: 0,
      totalTax: 0,
      grandTotal: subtotal,
    }
  })()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    const idToUse = searchParams.get("invoiceId") ?? invoiceId
    if (!idToUse) {
      setError("Invoice ID is required")
      return
    }

    if (items.length === 0) {
      setError("Please add at least one item")
      return
    }

    if (!reason.trim()) {
      setError("Please provide a reason for this credit note")
      return
    }

    // Check if credit note would exceed invoice credit cap.
    // Accounting rule: paid invoices may still be credited; cap is invoice gross minus already-applied credits.
    const rawTotal = Number(invoice?.total || 0)
    const derivedGross = Math.round((Number(invoice?.subtotal || 0) + Number(invoice?.total_tax || 0)) * 100) / 100
    const invoiceGross = rawTotal > 0 ? rawTotal : derivedGross
    const creditsGross =
      Math.round(
        creditNotes
          .filter((cn) => cn.status === "applied")
          .reduce((sum, cn) => sum + Number(cn.total || 0), 0) * 100
      ) / 100
    const remainingCreditableRounded = Math.round(Math.max(0, invoiceGross - creditsGross) * 100) / 100
    const creditTotalRounded = Math.round(taxResult.grandTotal * 100) / 100

    // Temporary: verify remaining balance inputs (remove after verification)
    console.log("[credit-note credit-cap validation]", {
      invoiceGross,
      creditsGross,
      remainingCreditableRounded,
      creditTotalRounded,
    })

    if (creditTotalRounded > remainingCreditableRounded) {
      const hint = remainingCreditableRounded === 0 && invoiceGross === 0
        ? " Invoice total may be missing or zero; check the invoice."
        : ""
      setError(`Credit note amount (₵${creditTotalRounded.toFixed(2)}) cannot exceed remaining creditable amount on this invoice (₵${remainingCreditableRounded.toFixed(2)}).${hint}`)
      return
    }

    try {
      setSaving(true)

      const response = await fetch("/api/credit-notes/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          invoice_id: idToUse,
          date,
          reason: reason.trim(),
          notes: notes.trim() || null,
          apply_taxes: applyTaxes,
          items: items.map((item) => ({
            invoice_item_id: item.invoice_item_id,
            description: item.description,
            qty: item.qty,
            unit_price: item.unit_price,
            discount_amount: getDiscountAmount(item),
          })),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setError(errorData.error || "Failed to create credit note")
        setSaving(false)
        return
      }

      const { creditNote } = await response.json()
      router.push(`/credit-notes/${creditNote.id}/view`)
    } catch (err: any) {
      setError(err.message || "Failed to create credit note")
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <p>Loading...</p>
      </div>
    )
  }

  if (showInvoicePicker) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
          <h1 className="text-2xl font-bold mb-2">Create Credit Note</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Select an invoice to create a credit note against. Credit notes can only be created for sent, paid, or overdue invoices.
          </p>
          {loadingInvoices ? (
            <p className="text-gray-500">Loading invoices…</p>
          ) : invoiceList.length === 0 ? (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <p className="text-amber-800 dark:text-amber-200 font-medium">No eligible invoices</p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                Create and send an invoice first, then return here to issue a credit note.
              </p>
              <button
                type="button"
                onClick={() => router.push("/invoices")}
                className="mt-3 text-blue-600 dark:text-blue-400 font-medium hover:underline"
              >
                Go to Invoices →
              </button>
            </div>
          ) : (
            <ul className="space-y-2 border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700">
              {invoiceList.map((inv) => (
                <li key={inv.id}>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        sessionStorage.setItem(STORAGE_KEY, inv.id)
                      } catch {
                        /* ignore */
                      }
                      router.replace(`/credit-notes/create?invoiceId=${encodeURIComponent(inv.id)}`)
                    }}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 flex justify-between items-center"
                  >
                    <span className="font-medium">{inv.invoice_number}</span>
                    <span className="text-gray-500 text-sm">
                      {inv.customers?.name ?? "No customer"} · {(Number(inv.total) || 0).toFixed(2)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => router.push("/credit-notes")}
            className="mt-6 text-gray-600 dark:text-gray-400 hover:underline"
          >
            ← Back to Credit Notes
          </button>
        </div>
    )
  }

  if (error && !invoice) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      </div>
    )
  }

  return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <button
              onClick={() => router.back()}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4 flex items-center gap-2 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
              Create Credit Note
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-lg">
              For Invoice #{invoice?.invoice_number || invoiceId}
            </p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Info */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Credit Note Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Date *
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Reason *
                  </label>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="e.g., Return, Refund, Adjustment"
                  />
                </div>
              </div>
              <div className="mt-4">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Additional notes"
                />
              </div>
            </div>

            {/* Items */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Credit Note Items</h2>
                <button
                  type="button"
                  onClick={addItem}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium text-sm transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Item
                </button>
              </div>

              {items.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">No items added yet</p>
              ) : (
                <div className="space-y-4">
                  {items.map((item) => (
                    <div key={item.id} className="grid grid-cols-12 gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                      <div className="col-span-12 md:col-span-5">
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Description</label>
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => updateItem(item.id, "description", e.target.value)}
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                          required
                        />
                      </div>
                      <div className="col-span-4 min-w-0 md:col-span-2">
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Qty</label>
                        <input
                          type="number"
                          value={item.qty}
                          onChange={(e) => updateItem(item.id, "qty", Number(e.target.value) || 0)}
                          min="0"
                          step="0.01"
                          className="w-full min-h-[2.25rem] min-w-[3.5rem] border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white tabular-nums text-center"
                          required
                        />
                      </div>
                      <div className="col-span-4 min-w-0 md:col-span-2">
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Unit Price</label>
                        <input
                          type="number"
                          value={item.unit_price}
                          onChange={(e) => updateItem(item.id, "unit_price", Number(e.target.value) || 0)}
                          min="0"
                          step="0.01"
                          className="w-full min-h-[2.25rem] min-w-[5.5rem] border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white tabular-nums text-right"
                          required
                        />
                      </div>
                      <div className="col-span-4 min-w-0 md:col-span-2">
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Discount</label>
                        <div className="flex min-w-0 items-stretch gap-2">
                          <select
                            value={item.discount_type}
                            onChange={(e) => updateItem(item.id, "discount_type", e.target.value as any)}
                            aria-label="Discount type"
                            className="w-[4.5rem] shrink-0 self-center border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                          >
                            <option value="amount">Amt</option>
                            <option value="percent">%</option>
                          </select>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={item._rawDiscount ?? (item.discount_value === 0 ? "" : String(item.discount_value))}
                            onChange={(e) => updateItem(item.id, "discount_value", e.target.value)}
                            onBlur={() => updateItem(item.id, "_rawDiscount", undefined)}
                            placeholder={item.discount_type === "percent" ? "0" : "0.00"}
                            className="min-w-0 flex-1 min-h-[2.25rem] border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white text-right tabular-nums"
                          />
                        </div>
                      </div>
                      <div className="col-span-12 md:col-span-1 flex items-end">
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 p-2"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Tax Toggle */}
              <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                <label className="flex items-center cursor-pointer">
                  <div className="flex items-center justify-between w-full">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-gray-900">
                        Apply Ghana Taxes
                      </label>
                      <p className="text-xs text-gray-500 mt-1">
                        Include NHIL, GETFund, and VAT
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={applyTaxes}
                      onClick={() => setApplyTaxes(!applyTaxes)}
                      className={`
                        relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
                        transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                        ${applyTaxes ? 'bg-blue-600' : 'bg-gray-200'}
                      `}
                    >
                      <span
                        className={`
                          pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0
                          transition duration-200 ease-in-out
                          ${applyTaxes ? 'translate-x-5' : 'translate-x-0'}
                        `}
                      />
                    </button>
                  </div>
                </label>
              </div>

              {/* Totals Preview */}
              <div className="mt-6 pt-6 border-t-2 border-gray-300 dark:border-gray-600">
                <div className="flex justify-end">
                  <div className="w-72 space-y-3 bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-800/20 rounded-lg p-5 border border-red-200 dark:border-red-700">
                    <div className="flex justify-between items-center">
                      <span className="text-red-900 dark:text-red-300 font-medium">
                        {applyTaxes ? "Subtotal (before tax):" : "Subtotal:"}
                      </span>
                      <span className="font-semibold text-red-900 dark:text-red-300 text-lg">₵{taxResult.subtotalBeforeTax.toFixed(2)}</span>
                    </div>
                    {totalDiscount > 0 && (
                      <div className="flex justify-between items-center text-sm text-red-800 dark:text-red-400">
                        <span>Discounts</span>
                        <span className="font-medium text-rose-600 tabular-nums">−₵{totalDiscount.toFixed(2)}</span>
                      </div>
                    )}
                    {applyTaxes && (
                      <>
                        <div className="space-y-1 pt-2 border-t border-red-200 dark:border-red-500">
                          {taxResult.nhil > 0 && (
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-red-800 dark:text-red-400">NHIL (2.5%):</span>
                              <span className="text-red-900 dark:text-red-300">₵{taxResult.nhil.toFixed(2)}</span>
                            </div>
                          )}
                          {taxResult.getfund > 0 && (
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-red-800 dark:text-red-400">GETFund (2.5%):</span>
                              <span className="text-red-900 dark:text-red-300">₵{taxResult.getfund.toFixed(2)}</span>
                            </div>
                          )}
                          {taxResult.vat > 0 && (
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-red-800 dark:text-red-400">VAT (15%):</span>
                              <span className="text-red-900 dark:text-red-300">₵{taxResult.vat.toFixed(2)}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-red-200 dark:border-red-500">
                          <span className="text-red-900 dark:text-red-300 font-medium">Total Tax:</span>
                          <span className="font-semibold text-red-900 dark:text-red-300">₵{taxResult.totalTax.toFixed(2)}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between items-center pt-3 border-t-2 border-red-300 dark:border-red-500">
                      <span className="text-red-900 dark:text-red-300 font-bold text-lg">Total Credit:</span>
                      <span className="font-bold text-red-600 dark:text-red-400 text-xl">-₵{taxResult.grandTotal.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-4 pt-4">
              <button
                type="button"
                onClick={() => router.back()}
                className="flex-1 bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-6 py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 font-medium transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 font-medium shadow-lg transition-all flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Creating...
                  </>
                ) : (
                  "Create Credit Note"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
  )
}

export default function CreateCreditNotePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <CreateCreditNoteContent />
    </Suspense>
  )
}

