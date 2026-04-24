"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { formatMoney } from "@/lib/money"
import { useToast } from "@/components/ui/ToastProvider"
import TierGate from "@/components/service/TierGate"
import { NativeSelect } from "@/components/ui/NativeSelect"
import type { WhtReceivableRow } from "@/lib/wht/receivableTypes"

type WHTBill = {
  id: string
  bill_number: string
  supplier_name: string
  issue_date: string
  total: number
  wht_rate: number
  wht_amount: number
  wht_remitted_at: string | null
  wht_remittance_ref: string | null
  status: string
}

type SupplierSubTab = "pending" | "remitted"

type WorkspaceTab = "payable" | "receivable"

function statusLabel(s: WhtReceivableRow["deduction_status"]): string {
  if (s === "pending") return "Pending"
  if (s === "partially_deducted") return "Partially deducted"
  return "Deducted"
}

function statusClass(s: WhtReceivableRow["deduction_status"]): string {
  if (s === "pending")
    return "bg-slate-100 text-slate-800 dark:bg-slate-800/60 dark:text-slate-200"
  if (s === "partially_deducted")
    return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
  return "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200"
}

export default function WHTRegisterPage() {
  const router = useRouter()
  const toast = useToast()

  const [businessId, setBusinessId] = useState("")
  const [currencyCode, setCurrencyCode] = useState("")
  const [loading, setLoading] = useState(true)
  const [workspace, setWorkspace] = useState<WorkspaceTab>("payable")

  const [pending, setPending] = useState<WHTBill[]>([])
  const [remitted, setRemitted] = useState<WHTBill[]>([])
  const [totalPending, setTotalPending] = useState(0)
  const [supplierTab, setSupplierTab] = useState<SupplierSubTab>("pending")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [remitting, setRemitting] = useState(false)
  const [showRemitModal, setShowRemitModal] = useState(false)
  const [remittanceDate, setRemittanceDate] = useState(new Date().toISOString().split("T")[0])
  const [remittanceRef, setRemittanceRef] = useState("")
  const [paymentAccount, setPaymentAccount] = useState("1010")

  const [receivableRows, setReceivableRows] = useState<WhtReceivableRow[]>([])
  const [receivableSummary, setReceivableSummary] = useState({
    total_expected: 0,
    total_deducted: 0,
    total_outstanding: 0,
  })
  const [receivableLoading, setReceivableLoading] = useState(false)

  const loadPayable = useCallback(async (bid: string) => {
    const res = await fetch(`/api/wht?business_id=${bid}`)
    const data = await res.json()
    if (!res.ok) {
      toast.showToast(data.error || "Could not load supplier WHT", "error")
      return
    }
    setPending(data.pending ?? [])
    setRemitted(data.remitted ?? [])
    setTotalPending(data.totalPending ?? 0)
  }, [toast])

  const loadReceivable = useCallback(async (bid: string) => {
    setReceivableLoading(true)
    try {
      const res = await fetch(`/api/wht/receivable?business_id=${bid}`)
      const data = await res.json()
      if (!res.ok) {
        toast.showToast(data.error || "Could not load customer WHT", "error")
        setReceivableRows([])
        return
      }
      setReceivableRows(data.rows ?? [])
      setReceivableSummary(
        data.summary ?? { total_expected: 0, total_deducted: 0, total_outstanding: 0 }
      )
    } finally {
      setReceivableLoading(false)
    }
  }, [toast])

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true)
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return

        const business = await getCurrentBusiness(supabase, user.id)
        if (!business) return

        setBusinessId(business.id)
        setCurrencyCode(business.default_currency || "")
        await loadPayable(business.id)
      } finally {
        setLoading(false)
      }
    }
    void init()
  }, [loadPayable])

  useEffect(() => {
    if (workspace === "receivable" && businessId) {
      void loadReceivable(businessId)
    }
  }, [workspace, businessId, loadReceivable])

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === pending.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(pending.map((b) => b.id)))
    }
  }

  const selectedTotal = pending
    .filter((b) => selected.has(b.id))
    .reduce((s, b) => s + Number(b.wht_amount), 0)

  const handleRemit = async () => {
    if (!selected.size) return
    setRemitting(true)
    try {
      const res = await fetch("/api/wht", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          bill_ids: Array.from(selected),
          remittance_date: remittanceDate,
          reference: remittanceRef || null,
          payment_account: paymentAccount,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.showToast(data.error || "Failed to record remittance", "error")
        return
      }

      const partialLedgerFailure =
        res.status === 207 || data.success === false

      if (partialLedgerFailure) {
        const msg =
          typeof data.error === "string" && data.error.trim().length > 0
            ? data.error
            : "Remittance was recorded but ledger posting failed. Check with your accountant or support before retrying."
        toast.showToast(msg, "warning")
      } else {
        toast.showToast(`WHT ${formatMoney(data.total_remitted, currencyCode || null)} remitted to GRA`, "success")
      }

      setShowRemitModal(false)
      setSelected(new Set())
      setRemittanceRef("")
      await loadPayable(businessId)
    } finally {
      setRemitting(false)
    }
  }

  const displayBills = supplierTab === "pending" ? pending : remitted

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Loading WHT…</p>
      </div>
    )
  }

  return (
    <TierGate minTier="professional">
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-6">
            <button
              type="button"
              onClick={() => router.push("/service/accounting")}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4 flex items-center gap-2 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Accounting
            </button>

            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Withholding tax (WHT)</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1 max-w-3xl">
              Finza tracks two different WHT flows:{" "}
              <strong className="text-gray-800 dark:text-gray-200">supplier WHT payable</strong> (you withhold from
              suppliers and owe GRA) and{" "}
              <strong className="text-gray-800 dark:text-gray-200">customer WHT receivable</strong> (your customers
              withheld from your invoices — an asset until you use or recover the credit).
            </p>
          </div>

          {/* Workspace tabs */}
          <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-700 mb-8">
            <button
              type="button"
              onClick={() => setWorkspace("payable")}
              className={`px-4 py-3 text-sm font-semibold rounded-t-lg border-b-2 -mb-px transition-colors ${
                workspace === "payable"
                  ? "border-orange-500 text-orange-700 dark:text-orange-300 bg-white dark:bg-gray-800"
                  : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
              }`}
            >
              WHT payable — suppliers
            </button>
            <button
              type="button"
              onClick={() => setWorkspace("receivable")}
              className={`px-4 py-3 text-sm font-semibold rounded-t-lg border-b-2 -mb-px transition-colors ${
                workspace === "receivable"
                  ? "border-sky-500 text-sky-800 dark:text-sky-200 bg-white dark:bg-gray-800"
                  : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
              }`}
            >
              WHT receivable — customers
            </button>
          </div>

          {workspace === "payable" && (
            <>
              <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Supplier WHT (liability)</h2>
                  <p className="text-gray-600 dark:text-gray-400 mt-1 text-sm">
                    Amounts you withheld from supplier bills and must remit to GRA. Posted to WHT payable.
                  </p>
                </div>
                {pending.length > 0 && (
                  <div className="text-left sm:text-right">
                    <p className="text-sm text-gray-500 dark:text-gray-400">Pending remittance</p>
                    <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                      {formatMoney(totalPending, currencyCode || null)}
                    </p>
                  </div>
                )}
              </div>

              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 mb-6">
                <div className="flex gap-3">
                  <svg
                    className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div className="text-sm text-amber-900 dark:text-amber-200">
                    <p className="font-semibold mb-1">How supplier WHT works</p>
                    <p>
                      When you pay a supplier, you may deduct WHT at source and remit it to GRA on their behalf. The
                      supplier receives the net amount; you track the liability here until you record remittance.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
                {(["pending", "remitted"] as SupplierSubTab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSupplierTab(t)}
                    className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                      supplierTab === t
                        ? "border-orange-500 text-orange-600 dark:text-orange-400"
                        : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    }`}
                  >
                    {t === "pending" ? `Pending (${pending.length})` : `Remitted (${remitted.length})`}
                  </button>
                ))}
              </div>

              {supplierTab === "pending" && pending.length > 0 && (
                <div className="flex items-center justify-between mb-4">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.size === pending.length && pending.length > 0}
                      onChange={toggleAll}
                      className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                    />
                    Select all
                  </label>
                  {selected.size > 0 && (
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {selected.size} selected · {formatMoney(selectedTotal, currencyCode || null)} WHT
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowRemitModal(true)}
                        className="bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 text-sm font-medium shadow transition-all"
                      >
                        Record remittance to GRA
                      </button>
                    </div>
                  )}
                </div>
              )}

              {displayBills.length === 0 ? (
                <div className="text-center py-16 text-gray-400 dark:text-gray-500 border border-dashed border-gray-200 dark:border-gray-700 rounded-2xl">
                  <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"
                    />
                  </svg>
                  <p className="font-medium text-gray-600 dark:text-gray-400">
                    {supplierTab === "pending" ? "No supplier WHT pending remittance." : "No supplier remittances yet."}
                  </p>
                  <p className="text-sm mt-2 max-w-md mx-auto text-gray-500 dark:text-gray-500">
                    Create a supplier bill with WHT applied to see rows here. This register does{" "}
                    <strong>not</strong> list customer WHT — use the &quot;WHT receivable — customers&quot; tab for
                    sales invoices.
                  </p>
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
                  <div className="px-4 py-2 bg-orange-50/80 dark:bg-orange-950/30 border-b border-orange-100 dark:border-orange-900/40 text-xs text-orange-900 dark:text-orange-200">
                    Supplier bills — WHT <span className="font-semibold">payable</span> (liability)
                  </div>
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        {supplierTab === "pending" && <th className="px-4 py-3 w-10" />}
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Bill
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Supplier
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Date
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Bill total
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          WHT amount
                        </th>
                        {supplierTab === "remitted" && (
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                            Remitted
                          </th>
                        )}
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {displayBills.map((bill) => (
                        <tr key={bill.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                          {supplierTab === "pending" && (
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                checked={selected.has(bill.id)}
                                onChange={() => toggleSelect(bill.id)}
                                className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                              />
                            </td>
                          )}
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => router.push(`/bills/${bill.id}/view`)}
                              className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              #{bill.bill_number}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{bill.supplier_name}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                            {new Date(bill.issue_date).toLocaleDateString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                            {formatMoney(Number(bill.total), currencyCode || null)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-semibold text-orange-600 dark:text-orange-400">
                            {formatMoney(Number(bill.wht_amount), currencyCode || null)}
                            <span className="text-xs text-gray-400 ml-1">
                              ({((bill.wht_rate ?? 0) * 100).toFixed(0)}%)
                            </span>
                          </td>
                          {supplierTab === "remitted" && (
                            <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                              {bill.wht_remitted_at
                                ? new Date(bill.wht_remitted_at).toLocaleDateString("en-GB", {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                  })
                                : "—"}
                              {bill.wht_remittance_ref && (
                                <span className="block text-xs text-gray-400">Ref: {bill.wht_remittance_ref}</span>
                              )}
                            </td>
                          )}
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                bill.wht_remitted_at
                                  ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                                  : "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300"
                              }`}
                            >
                              {bill.wht_remitted_at ? "Remitted" : "Pending"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {supplierTab === "pending" && pending.length > 1 && (
                      <tfoot className="bg-orange-50 dark:bg-orange-900/10 border-t-2 border-orange-200 dark:border-orange-800">
                        <tr>
                          <td colSpan={5} className="px-4 py-3 text-sm font-bold text-orange-900 dark:text-orange-300">
                            Total pending
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-orange-600 dark:text-orange-400">
                            {formatMoney(totalPending, currencyCode || null)}
                          </td>
                          <td className="px-4 py-3" />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </>
          )}

          {workspace === "receivable" && (
            <>
              <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Customer WHT (asset / receivable)</h2>
                  <p className="text-gray-600 dark:text-gray-400 mt-1 text-sm max-w-2xl">
                    When a customer withholds tax from your invoice, Finza stores expected WHT on the invoice and the
                    actual WHT on each payment. Ledger posting debits your WHT receivable control account when you
                    record a payment with WHT.
                  </p>
                </div>
                {!receivableLoading && receivableRows.length > 0 && (
                  <div className="flex flex-wrap gap-6 text-sm">
                    <div>
                      <p className="text-gray-500 dark:text-gray-400">Expected (invoices)</p>
                      <p className="font-semibold text-gray-900 dark:text-white">
                        {formatMoney(receivableSummary.total_expected, currencyCode || null)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500 dark:text-gray-400">Recorded on payments</p>
                      <p className="font-semibold text-sky-700 dark:text-sky-300">
                        {formatMoney(receivableSummary.total_deducted, currencyCode || null)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500 dark:text-gray-400">Outstanding</p>
                      <p className="font-semibold text-amber-700 dark:text-amber-300">
                        {formatMoney(receivableSummary.total_outstanding, currencyCode || null)}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 rounded-xl p-4 mb-6">
                <div className="flex gap-3">
                  <svg
                    className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div className="text-sm text-sky-900 dark:text-sky-100">
                    <p className="font-semibold mb-1">How customer WHT works</p>
                    <p>
                      You enable WHT on a sales invoice when the customer will withhold tax. Each payment can include a
                      WHT amount; that posts separately from cash received. Status here compares invoice expected WHT to
                      the sum of WHT entered on payments (pending → partially deducted → deducted).
                    </p>
                  </div>
                </div>
              </div>

              {receivableLoading ? (
                <p className="text-gray-500 py-12 text-center">Loading customer WHT…</p>
              ) : receivableRows.length === 0 ? (
                <div className="text-center py-16 text-gray-400 dark:text-gray-500 border border-dashed border-gray-200 dark:border-gray-700 rounded-2xl">
                  <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <p className="font-medium text-gray-600 dark:text-gray-400">No customer WHT receivable rows yet.</p>
                  <p className="text-sm mt-2 max-w-lg mx-auto text-gray-500 dark:text-gray-500">
                    Issue an invoice with &quot;WHT receivable&quot; enabled and record payments with a WHT amount to
                    see data here. This view does <strong>not</strong> include supplier WHT — use &quot;WHT payable —
                    suppliers&quot; for bills you pay.
                  </p>
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-x-auto">
                  <div className="px-4 py-2 bg-sky-50/80 dark:bg-sky-950/30 border-b border-sky-100 dark:border-sky-900/40 text-xs text-sky-900 dark:text-sky-200">
                    Sales invoices &amp; payments — WHT <span className="font-semibold">receivable</span> (asset)
                  </div>
                  <table className="w-full min-w-[960px]">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Invoice
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Customer
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Inv. date
                        </th>
                        <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Inv. total
                        </th>
                        <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Expected WHT
                        </th>
                        <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          WHT this payment
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Payment date
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Reference
                        </th>
                        <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          WHT balance
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Deduction status
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Invoice status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {receivableRows.map((row) => (
                        <tr key={`${row.invoice_id}-${row.payment_id ?? "none"}`} className="hover:bg-gray-50/80 dark:hover:bg-gray-700/40">
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              onClick={() => router.push(`/invoices/${row.invoice_id}/view`)}
                              className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              #{row.invoice_number}
                            </button>
                          </td>
                          <td className="px-3 py-2.5 text-sm text-gray-900 dark:text-white">{row.customer_name}</td>
                          <td className="px-3 py-2.5 text-sm text-gray-600 dark:text-gray-400">
                            {new Date(row.issue_date).toLocaleDateString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </td>
                          <td className="px-3 py-2.5 text-sm text-right">
                            {formatMoney(row.invoice_total, currencyCode || null)}
                          </td>
                          <td className="px-3 py-2.5 text-sm text-right font-medium text-gray-900 dark:text-white">
                            {formatMoney(row.expected_wht, currencyCode || null)}
                          </td>
                          <td className="px-3 py-2.5 text-sm text-right text-sky-700 dark:text-sky-300">
                            {row.payment_id == null ? "—" : formatMoney(row.wht_on_payment ?? 0, currencyCode || null)}
                          </td>
                          <td className="px-3 py-2.5 text-sm text-gray-600 dark:text-gray-400">
                            {row.payment_date
                              ? new Date(row.payment_date).toLocaleDateString("en-GB", {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                })
                              : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-sm text-gray-600 dark:text-gray-400 max-w-[140px] truncate" title={row.payment_reference ?? ""}>
                            {row.payment_reference ?? "—"}
                          </td>
                          <td className="px-3 py-2.5 text-sm text-right text-amber-800 dark:text-amber-200">
                            {formatMoney(row.wht_outstanding, currencyCode || null)}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(row.deduction_status)}`}>
                              {statusLabel(row.deduction_status)}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-gray-500 capitalize">{row.invoice_status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showRemitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Record WHT remittance</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              Recording {selected.size} bill{selected.size !== 1 ? "s" : ""} · Total:{" "}
              {formatMoney(selectedTotal, currencyCode || null)}
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Remittance date *
                </label>
                <input
                  type="date"
                  value={remittanceDate}
                  onChange={(e) => setRemittanceDate(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  GRA receipt / reference
                </label>
                <input
                  type="text"
                  value={remittanceRef}
                  onChange={(e) => setRemittanceRef(e.target.value)}
                  placeholder="GRA transaction reference"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Paid from</label>
                <NativeSelect value={paymentAccount} onChange={(e) => setPaymentAccount(e.target.value)} size="sm">
                  <option value="1010">Bank</option>
                  <option value="1000">Cash</option>
                  <option value="1020">Mobile money</option>
                </NativeSelect>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowRemitModal(false)}
                className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 font-medium text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRemit}
                disabled={remitting || !remittanceDate}
                className="flex-1 bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 disabled:opacity-50 font-medium text-sm shadow flex items-center justify-center gap-2"
              >
                {remitting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <title>Loading</title>
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Recording…
                  </>
                ) : (
                  `Record ${formatMoney(selectedTotal, currencyCode || null)} remittance`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </TierGate>
  )
}
