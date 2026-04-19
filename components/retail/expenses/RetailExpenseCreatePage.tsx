"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { retailPaths, retailExpenseApi } from "@/lib/retail/routes"
import { calculateBaseFromTotalIncludingTaxes } from "@/lib/ghanaTaxEngine"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import {
  RetailBackofficeAlert,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
  RetailBackofficeBackLink,
  retailFieldClass,
  retailLabelClass,
  RetailMenuSelect,
  type MenuSelectOption,
} from "@/components/retail/RetailBackofficeUi"

type Category = { id: string; name: string }

const PAYMENT_OPTIONS: MenuSelectOption[] = [
  { value: "cash", label: "Cash" },
  { value: "momo", label: "Mobile money" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank transfer" },
  { value: "other", label: "Other" },
]

function composeNotes(paymentValue: string, userNote: string): string | null {
  const opt = PAYMENT_OPTIONS.find((p) => p.value === paymentValue)
  const tag = `[Payment: ${opt?.label ?? paymentValue}]`
  const trimmed = userNote.trim()
  return trimmed ? `${tag}\n${trimmed}` : tag
}

export default function RetailExpenseCreatePage() {
  const router = useRouter()
  const { format, ready: currencyReady } = useBusinessCurrency()

  const [categories, setCategories] = useState<Category[]>([])
  const [categoryId, setCategoryId] = useState("")
  const [newCategoryName, setNewCategoryName] = useState("")
  const [addingCategory, setAddingCategory] = useState(false)

  const categoryMenuOptions = useMemo(() => {
    const head: MenuSelectOption[] = [{ value: "", label: "Select…" }]
    return head.concat(categories.map((c) => ({ value: c.id, label: c.name })))
  }, [categories])

  const [payee, setPayee] = useState("")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0])
  const [applyTaxes, setApplyTaxes] = useState(true)
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [note, setNote] = useState("")
  const [receiptFile, setReceiptFile] = useState<File | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const loadCats = async () => {
      const res = await fetch(retailExpenseApi.categories)
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.categories)) {
        setCategories(data.categories.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })))
      }
    }
    void loadCats()
  }, [])

  const uploadReceipt = async (businessId: string): Promise<string | null> => {
    if (!receiptFile) return null
    const ext = receiptFile.name.split(".").pop() || "bin"
    const path = `expenses/${businessId}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from("receipts").upload(path, receiptFile)
    if (upErr) {
      console.error(upErr)
      return null
    }
    return path
  }

  const handleAddCategory = async () => {
    const name = newCategoryName.trim()
    if (!name) return
    setAddingCategory(true)
    try {
      const res = await fetch(retailExpenseApi.categories, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not add category")
        return
      }
      if (data.category?.id) {
        setCategories((prev) => [...prev, { id: data.category.id, name: data.category.name }].sort((a, b) => a.name.localeCompare(b.name)))
        setCategoryId(data.category.id)
        setNewCategoryName("")
      }
    } finally {
      setAddingCategory(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (!payee.trim()) {
      setError("Enter who you paid (supplier or merchant).")
      return
    }
    const totalIncl = Number(amount)
    if (!amount || Number.isNaN(totalIncl) || totalIncl <= 0) {
      setError("Enter a valid total amount.")
      return
    }

    setLoading(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setError("Sign in to continue.")
        return
      }

      const { getCurrentBusiness } = await import("@/lib/business")
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business?.id) {
        setError("No store found.")
        return
      }

      let base = totalIncl
      let nhil = 0,
        getfund = 0,
        covid = 0,
        vat = 0
      if (applyTaxes) {
        const r = calculateBaseFromTotalIncludingTaxes(totalIncl, true, date)
        base = r.baseAmount
        nhil = r.taxBreakdown.nhil
        getfund = r.taxBreakdown.getfund
        covid = r.taxBreakdown.covid
        vat = r.taxBreakdown.vat
      }

      const receiptPath = await uploadReceipt(business.id)
      const notes = composeNotes(paymentMethod, note)

      const res = await fetch(retailExpenseApi.create, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier: payee.trim(),
          category_id: categoryId || null,
          amount: base,
          nhil,
          getfund,
          covid,
          vat,
          total: totalIncl,
          date,
          notes,
          receipt_path: receiptPath,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not save expense")
        return
      }
      if (data.expense?.id) {
        router.push(retailPaths.expenseDetail(data.expense.id as string))
      } else {
        router.push(retailPaths.expenses)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save expense")
    } finally {
      setLoading(false)
    }
  }

  const totalPreview = Number(amount) || 0
  let taxPreview = { nhil: 0, getfund: 0, covid: 0, vat: 0, totalTax: 0 }
  if (applyTaxes && totalPreview > 0) {
    const r = calculateBaseFromTotalIncludingTaxes(totalPreview, true, date)
    taxPreview = r.taxBreakdown
  }

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain className="max-w-xl">
        <RetailBackofficeBackLink onClick={() => router.push(retailPaths.expenses)}>Back to expenses</RetailBackofficeBackLink>

        <RetailBackofficePageHeader
          eyebrow="Store finances"
          title="Add store expense"
          description="Operating costs only. Buying products to sell belongs under Inventory — not here."
        />

        <RetailBackofficeCard>
          <p className="mb-4 text-sm text-slate-600">
            <button
              type="button"
              className="font-medium text-slate-900 underline-offset-2 hover:underline"
              onClick={() => router.push(retailPaths.inventory)}
            >
              Restocking inventory?
            </button>{" "}
            Use inventory instead of this form.
          </p>

          {error ? (
            <RetailBackofficeAlert tone="error" className="mb-4">
              {error}
            </RetailBackofficeAlert>
          ) : null}

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className={retailLabelClass}>Date</label>
              <input type="date" className={retailFieldClass} value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>

            <div>
              <label className={retailLabelClass}>Payee / vendor</label>
              <input
                className={retailFieldClass}
                placeholder="e.g. ECG, Uber, cleaning supplies shop"
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
                required
              />
            </div>

            <div>
              <label className={retailLabelClass}>Category</label>
              <RetailMenuSelect value={categoryId} onValueChange={setCategoryId} options={categoryMenuOptions} />
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  className={`${retailFieldClass} max-w-[200px]`}
                  placeholder="New category name"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                />
                <RetailBackofficeButton variant="secondary" type="button" disabled={addingCategory} onClick={() => void handleAddCategory()}>
                  Add category
                </RetailBackofficeButton>
              </div>
            </div>

            <div>
              <label className={retailLabelClass}>Total paid (including VAT if applicable)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                className={retailFieldClass}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
              {currencyReady && totalPreview > 0 ? (
                <p className="mt-1 text-xs text-slate-500">
                  {applyTaxes ? (
                    <>
                      Estimated VAT/GetFund/NHIL split for this date — net base ≈{" "}
                      {format(calculateBaseFromTotalIncludingTaxes(totalPreview, true, date).baseAmount)} (total{" "}
                      {format(totalPreview)})
                    </>
                  ) : (
                    <>No VAT split — full amount posts as the expense.</>
                  )}
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <input
                id="applyTaxes"
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={applyTaxes}
                onChange={(e) => setApplyTaxes(e.target.checked)}
              />
              <label htmlFor="applyTaxes" className="text-sm text-slate-700">
                Apply Ghana levies / VAT from total (same as other Finza expenses)
              </label>
            </div>

            {applyTaxes && totalPreview > 0 ? (
              <p className="text-xs text-slate-500">
                NHIL {taxPreview.nhil.toFixed(2)} · GETFund {taxPreview.getfund.toFixed(2)} · VAT {taxPreview.vat.toFixed(2)}
              </p>
            ) : null}

            <div>
              <label className={retailLabelClass}>How you paid</label>
              <RetailMenuSelect value={paymentMethod} onValueChange={setPaymentMethod} options={PAYMENT_OPTIONS} />
              <p className="mt-1 text-xs text-slate-500">
                For bookkeeping, spend is still posted against your main cash account like other simple expenses.
              </p>
            </div>

            <div>
              <label className={retailLabelClass}>Note (optional)</label>
              <textarea className={retailFieldClass} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was this for?" />
            </div>

            <div>
              <label className={retailLabelClass}>Receipt photo or PDF (optional)</label>
              <input type="file" accept="image/*,.pdf" className={retailFieldClass} onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} />
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <RetailBackofficeButton variant="primary" type="submit" disabled={loading}>
                {loading ? "Saving…" : "Save expense"}
              </RetailBackofficeButton>
              <RetailBackofficeButton variant="secondary" type="button" onClick={() => router.push(retailPaths.expenses)}>
                Cancel
              </RetailBackofficeButton>
            </div>
          </form>
        </RetailBackofficeCard>
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}
