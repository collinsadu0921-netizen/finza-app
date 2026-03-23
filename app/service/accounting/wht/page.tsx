"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { getCurrencySymbol } from "@/lib/currency"
import { resolveCurrencyDisplay } from "@/lib/currency/resolveCurrencyDisplay"
import { useToast } from "@/components/ui/ToastProvider"
import TierGate from "@/components/service/TierGate"

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

type Tab = "pending" | "remitted"

export default function WHTRegisterPage() {
  const router = useRouter()
  const toast = useToast()

  const [businessId, setBusinessId] = useState("")
  const [currencySymbol, setCurrencySymbol] = useState("")
  const [currencyCode, setCurrencyCode] = useState("")
  const [loading, setLoading] = useState(true)
  const [bills, setBills] = useState<WHTBill[]>([])
  const [pending, setPending] = useState<WHTBill[]>([])
  const [remitted, setRemitted] = useState<WHTBill[]>([])
  const [totalPending, setTotalPending] = useState(0)
  const [tab, setTab] = useState<Tab>("pending")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [remitting, setRemitting] = useState(false)
  const [showRemitModal, setShowRemitModal] = useState(false)
  const [remittanceDate, setRemittanceDate] = useState(new Date().toISOString().split("T")[0])
  const [remittanceRef, setRemittanceRef] = useState("")
  const [paymentAccount, setPaymentAccount] = useState("1010")

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) return

      setBusinessId(business.id)
      const sym = getCurrencySymbol(business.default_currency || "GHS")
      setCurrencySymbol(sym || "")
      setCurrencyCode(business.default_currency || "")

      const res = await fetch(`/api/wht?business_id=${business.id}`)
      const data = await res.json()
      setBills(data.bills ?? [])
      setPending(data.pending ?? [])
      setRemitted(data.remitted ?? [])
      setTotalPending(data.totalPending ?? 0)
    } finally {
      setLoading(false)
    }
  }

  const currency = resolveCurrencyDisplay({ currency_symbol: currencySymbol, currency_code: currencyCode })

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === pending.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(pending.map(b => b.id)))
    }
  }

  const selectedTotal = pending
    .filter(b => selected.has(b.id))
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
      const data = await res.json()
      if (!res.ok) {
        toast.showToast(data.error || "Failed to record remittance", "error")
        return
      }
      toast.showToast(`WHT ${currency}${data.total_remitted.toFixed(2)} remitted to GRA`, "success")
      setShowRemitModal(false)
      setSelected(new Set())
      setRemittanceRef("")
      await loadData()
    } finally {
      setRemitting(false)
    }
  }

  const displayBills = tab === "pending" ? pending : remitted

  if (loading) {
    return <div className="p-6"><p className="text-gray-500">Loading WHT register…</p></div>
  }

  return (
    <TierGate minTier="professional">
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* Header */}
          <div className="mb-8">
            <button
              onClick={() => router.push("/service/accounting")}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4 flex items-center gap-2 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Accounting
            </button>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-500 to-red-600 bg-clip-text text-transparent">
                  WHT Register
                </h1>
                <p className="text-gray-600 dark:text-gray-400 mt-1">
                  Withholding tax deducted from supplier payments
                </p>
              </div>
              {pending.length > 0 && (
                <div className="text-right">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Pending remittance</p>
                  <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                    {currency}{totalPending.toFixed(2)}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Info banner */}
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 mb-6">
            <div className="flex gap-3">
              <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm text-amber-800 dark:text-amber-300">
                <p className="font-semibold mb-1">How WHT works</p>
                <p>When you pay a supplier, you deduct WHT at source and remit it to GRA on their behalf. The supplier receives the net amount; GRA receives the withholding tax.</p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
            {(["pending", "remitted"] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  tab === t
                    ? "border-orange-500 text-orange-600 dark:text-orange-400"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                {t === "pending" ? `Pending (${pending.length})` : `Remitted (${remitted.length})`}
              </button>
            ))}
          </div>

          {/* Bulk action bar */}
          {tab === "pending" && pending.length > 0 && (
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
                    {selected.size} selected · {currency}{selectedTotal.toFixed(2)} WHT
                  </span>
                  <button
                    onClick={() => setShowRemitModal(true)}
                    className="bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 text-sm font-medium shadow transition-all"
                  >
                    Record Remittance to GRA
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Bills Table */}
          {displayBills.length === 0 ? (
            <div className="text-center py-16 text-gray-400 dark:text-gray-500">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
              </svg>
              <p>{tab === "pending" ? "No WHT pending remittance." : "No remittances recorded yet."}</p>
              {tab === "pending" && (
                <p className="text-sm mt-1">Create a bill with WHT applied to see it here.</p>
              )}
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    {tab === "pending" && <th className="px-4 py-3 w-10" />}
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Bill</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Supplier</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Date</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Bill Total</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                      WHT ({tab === "pending" ? "" : ""}Amount)
                    </th>
                    {tab === "remitted" && (
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Remitted</th>
                    )}
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {displayBills.map(bill => (
                    <tr
                      key={bill.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      {tab === "pending" && (
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
                          onClick={() => router.push(`/bills/${bill.id}/view`)}
                          className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          #{bill.bill_number}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{bill.supplier_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                        {new Date(bill.issue_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                        {currency}{Number(bill.total).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-orange-600 dark:text-orange-400">
                        {currency}{Number(bill.wht_amount).toFixed(2)}
                        <span className="text-xs text-gray-400 ml-1">({((bill.wht_rate ?? 0) * 100).toFixed(0)}%)</span>
                      </td>
                      {tab === "remitted" && (
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                          {bill.wht_remitted_at
                            ? new Date(bill.wht_remitted_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                            : "—"}
                          {bill.wht_remittance_ref && (
                            <span className="block text-xs text-gray-400">Ref: {bill.wht_remittance_ref}</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          bill.wht_remitted_at
                            ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                            : "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300"
                        }`}>
                          {bill.wht_remitted_at ? "Remitted" : "Pending"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {tab === "pending" && pending.length > 1 && (
                  <tfoot className="bg-orange-50 dark:bg-orange-900/10 border-t-2 border-orange-200 dark:border-orange-800">
                    <tr>
                      <td colSpan={4} className="px-4 py-3 text-sm font-bold text-orange-900 dark:text-orange-300">
                        Total Pending
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-orange-900 dark:text-orange-300"></td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-orange-600 dark:text-orange-400">
                        {currency}{totalPending.toFixed(2)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Remit Modal */}
      {showRemitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Record WHT Remittance</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              Recording {selected.size} bill{selected.size !== 1 ? "s" : ""} · Total: {currency}{selectedTotal.toFixed(2)}
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Remittance Date *</label>
                <input
                  type="date"
                  value={remittanceDate}
                  onChange={e => setRemittanceDate(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">GRA Receipt / Reference</label>
                <input
                  type="text"
                  value={remittanceRef}
                  onChange={e => setRemittanceRef(e.target.value)}
                  placeholder="GRA transaction reference"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Paid from</label>
                <select
                  value={paymentAccount}
                  onChange={e => setPaymentAccount(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 dark:bg-gray-700 dark:text-white"
                >
                  <option value="1010">Bank</option>
                  <option value="1000">Cash</option>
                  <option value="1020">Mobile Money</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowRemitModal(false)}
                className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleRemit}
                disabled={remitting || !remittanceDate}
                className="flex-1 bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 disabled:opacity-50 font-medium text-sm shadow flex items-center justify-center gap-2"
              >
                {remitting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Recording…
                  </>
                ) : (
                  `Record ${currency}${selectedTotal.toFixed(2)} Remittance`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </TierGate>
  )
}
