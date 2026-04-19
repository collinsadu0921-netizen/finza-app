"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { retailPaths, retailExpenseApi } from "@/lib/retail/routes"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import {
  RetailBackofficeAlert,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
  RetailBackofficeSubtle,
  retailFieldClass,
  retailLabelClass,
} from "@/components/retail/RetailBackofficeUi"

type ExpenseRow = {
  id: string
  supplier: string
  date: string
  total: number
  amount: number
  nhil?: number
  getfund?: number
  vat?: number
  notes?: string | null
  receipt_path?: string | null
  expense_categories?: { id: string; name: string } | null
}

export default function RetailExpensesListPage() {
  const router = useRouter()
  const { format, ready: currencyReady } = useBusinessCurrency()
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  const load = async () => {
    try {
      setLoading(true)
      setError("")
      const q = new URLSearchParams()
      q.set("limit", "200")
      if (dateFrom) q.set("start_date", dateFrom)
      if (dateTo) q.set("end_date", dateTo)
      const res = await fetch(`${retailExpenseApi.list}?${q.toString()}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not load expenses")
        setExpenses([])
        return
      }
      setExpenses(data.expenses || [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load expenses")
      setExpenses([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [dateFrom, dateTo])

  const exportCsv = useCallback(() => {
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`
    const header = [
      "expense_id",
      "date",
      "payee",
      "category",
      "amount_net",
      "nhil",
      "getfund",
      "vat",
      "total",
      "notes",
      "receipt_path",
    ]
    const lines = [header.join(",")]
    for (const e of expenses) {
      lines.push(
        [
          esc(e.id),
          esc(e.date),
          esc(e.supplier),
          esc(e.expense_categories?.name ?? ""),
          String(Number(e.amount ?? 0)),
          String(Number(e.nhil ?? 0)),
          String(Number(e.getfund ?? 0)),
          String(Number(e.vat ?? 0)),
          String(Number(e.total ?? e.amount ?? 0)),
          esc((e.notes ?? "").replace(/\r?\n/g, " ")),
          esc(e.receipt_path ?? ""),
        ].join(","),
      )
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    const range = [dateFrom || "all", dateTo || "all"].join("_")
    a.download = `store-expenses_${range}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [expenses, dateFrom, dateTo])

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain className="max-w-5xl">
        <RetailBackofficePageHeader
          eyebrow="Store finances"
          title="Store expenses"
          description="Record shop operating costs (supplies, utilities, transport, etc.). This is not for stock you resell — use inventory and purchase orders for that."
          actions={
            <div className="flex flex-wrap gap-2">
              <RetailBackofficeButton variant="secondary" type="button" onClick={exportCsv} disabled={!expenses.length || loading}>
                Export CSV
              </RetailBackofficeButton>
              <RetailBackofficeButton variant="primary" type="button" onClick={() => router.push(retailPaths.expenseNew)}>
                Add expense
              </RetailBackofficeButton>
            </div>
          }
        />

        {error ? (
          <RetailBackofficeAlert tone="error" className="mb-4">
            {error}
          </RetailBackofficeAlert>
        ) : null}

        <RetailBackofficeCard className="mb-6">
          <p className="mb-4 text-sm text-slate-600">
            Amounts post to your books automatically. They appear on Profit &amp; Loss under operating expenses and affect
            cash the same way as other Finza expenses.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={retailLabelClass}>From date</label>
              <input type="date" className={retailFieldClass} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className={retailLabelClass}>To date</label>
              <input type="date" className={retailFieldClass} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
          <RetailBackofficeSubtle className="mt-3">
            Export CSV includes up to 200 rows for the dates above (newest first). For larger extracts, narrow the date range
            and export again.
          </RetailBackofficeSubtle>
        </RetailBackofficeCard>

        <RetailBackofficeCard padding="p-0 sm:p-0">
          {loading ? (
            <div className="p-8 text-sm text-slate-500">Loading…</div>
          ) : expenses.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-slate-800">No expenses in this range</p>
              <RetailBackofficeSubtle className="mt-2">
                When you add costs, they show here with the date and payee.
              </RetailBackofficeSubtle>
              <RetailBackofficeButton
                variant="secondary"
                type="button"
                className="mt-6"
                onClick={() => router.push(retailPaths.expenseNew)}
              >
                Add your first expense
              </RetailBackofficeButton>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 sm:px-6">Date</th>
                    <th className="px-4 py-3 sm:px-6">Payee</th>
                    <th className="px-4 py-3 sm:px-6">Category</th>
                    <th className="px-4 py-3 sm:px-6 text-right">Total</th>
                    <th className="px-4 py-3 sm:px-6" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {expenses.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50/60">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700 sm:px-6">{e.date}</td>
                      <td className="px-4 py-3 font-medium text-slate-900 sm:px-6">{e.supplier}</td>
                      <td className="px-4 py-3 text-slate-600 sm:px-6">{e.expense_categories?.name ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-slate-900 sm:px-6">
                        {currencyReady ? format(Number(e.total ?? e.amount ?? 0)) : "—"}
                      </td>
                      <td className="px-4 py-3 sm:px-6">
                        <button
                          type="button"
                          className="text-sm font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
                          onClick={() => router.push(retailPaths.expenseDetail(e.id))}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </RetailBackofficeCard>
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}
