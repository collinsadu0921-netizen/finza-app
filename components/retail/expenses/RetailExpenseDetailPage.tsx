"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { retailPaths, retailExpenseApi } from "@/lib/retail/routes"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import {
  RetailBackofficeAlert,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
  RetailBackofficeBackLink,
} from "@/components/retail/RetailBackofficeUi"

type ExpenseDetail = {
  id: string
  supplier: string
  date: string
  amount: number
  nhil?: number
  getfund?: number
  covid?: number
  vat?: number
  total: number
  notes?: string | null
  receipt_path?: string | null
  expense_categories?: { id: string; name: string } | null
}

export default function RetailExpenseDetailPage({ expenseId }: { expenseId: string }) {
  const router = useRouter()
  const { format, formatWithCode, ready: currencyReady } = useBusinessCurrency()
  const [expense, setExpense] = useState<ExpenseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      setError("")
      try {
        const res = await fetch(retailExpenseApi.detail(expenseId))
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(typeof data.error === "string" ? data.error : "Could not load expense")
          setExpense(null)
          return
        }
        const ex = data.expense as ExpenseDetail
        setExpense(ex)
        if (ex.receipt_path) {
          const { data: pub } = supabase.storage.from("receipts").getPublicUrl(ex.receipt_path)
          setReceiptUrl(pub?.publicUrl ?? null)
        } else {
          setReceiptUrl(null)
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Could not load expense")
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [expenseId])

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain className="max-w-xl">
        <RetailBackofficeBackLink onClick={() => router.push(retailPaths.expenses)}>Back to expenses</RetailBackofficeBackLink>

        <RetailBackofficePageHeader
          eyebrow="Store finances"
          title="Expense detail"
          description="Posted to your books automatically when it was saved."
        />

        {error ? (
          <RetailBackofficeAlert tone="error" className="mb-4">
            {error}
          </RetailBackofficeAlert>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : expense ? (
          <RetailBackofficeCard className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payee</p>
              <p className="text-lg font-semibold text-slate-900">{expense.supplier}</p>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Date</p>
                <p className="font-medium text-slate-800">{expense.date}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Category</p>
                <p className="font-medium text-slate-800">{expense.expense_categories?.name ?? "—"}</p>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Total</p>
              <p className="text-xl font-semibold tabular-nums text-slate-900">
                {currencyReady ? formatWithCode(expense.total) : "—"}
              </p>
            </div>
            {(Number(expense.nhil) > 0 || Number(expense.getfund) > 0 || Number(expense.vat) > 0) && currencyReady ? (
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-700">Tax breakdown</p>
                <p>
                  NHIL {format(expense.nhil ?? 0)} · GETFund {format(expense.getfund ?? 0)} · VAT {format(expense.vat ?? 0)}
                </p>
                <p className="mt-1">Net expense amount {format(expense.amount)}</p>
              </div>
            ) : null}
            {expense.notes ? (
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Notes</p>
                <p className="whitespace-pre-wrap text-sm text-slate-800">{expense.notes}</p>
              </div>
            ) : null}
            {receiptUrl ? (
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Receipt</p>
                <a href={receiptUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-slate-900 underline">
                  Open receipt
                </a>
              </div>
            ) : null}
            <RetailBackofficeButton variant="secondary" type="button" onClick={() => router.push(retailPaths.expenses)}>
              Done
            </RetailBackofficeButton>
          </RetailBackofficeCard>
        ) : null}
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}
