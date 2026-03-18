"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { getCurrencySymbol } from "@/lib/currency"
import { resolveCurrencyDisplay } from "@/lib/currency/resolveCurrencyDisplay"
import { useToast } from "@/components/ui/ToastProvider"

// Ghana CIT rate codes → numeric rate + calculation basis
const CIT_RATES: Record<string, { rate: number; label: string; basis: "profit" | "turnover" }> = {
  standard_25:   { rate: 0.25, label: "25% – Standard Company",         basis: "profit" },
  hotel_22:      { rate: 0.22, label: "22% – Hotel Industry",           basis: "profit" },
  bank_20:       { rate: 0.20, label: "20% – Bank / Financial",         basis: "profit" },
  export_8:      { rate: 0.08, label: "8% – Non-Traditional Exports",   basis: "profit" },
  agro_1:        { rate: 0.01, label: "1% – Agro-processing",           basis: "profit" },
  mining_35:     { rate: 0.35, label: "35% – Mining / Petroleum",       basis: "profit" },
  presumptive_3: { rate: 0.03, label: "3% – Presumptive / Sole Trader", basis: "turnover" },
  exempt:        { rate: 0.00, label: "0% – Exempt",                    basis: "profit" },
}

type CITProvision = {
  id: string
  period_label: string
  provision_type: "quarterly" | "annual" | "final"
  chargeable_income: number
  cit_rate: number
  cit_amount: number
  status: "draft" | "posted" | "paid"
  journal_entry_id: string | null
  notes: string | null
  created_at: string
}

export default function CITPage() {
  const router = useRouter()
  const toast = useToast()

  const [businessId, setBusinessId] = useState("")
  const [currencySymbol, setCurrencySymbol] = useState("")
  const [currencyCode, setCurrencyCode] = useState("")
  const [citRateCode, setCitRateCode] = useState("standard_25")
  const [loading, setLoading] = useState(true)
  const [provisions, setProvisions] = useState<CITProvision[]>([])

  // P&L summary
  const [plLoading, setPlLoading] = useState(false)
  const [netProfit, setNetProfit] = useState<number | null>(null)
  const [plError, setPlError] = useState("")

  // New provision form
  const [showForm, setShowForm] = useState(false)
  const [periodLabel, setPeriodLabel] = useState("")
  const [provType, setProvType] = useState<"quarterly" | "annual" | "final">("quarterly")
  const [chargeableIncome, setChargeableIncome] = useState("")
  const [citRate, setCitRate] = useState(0.25)
  const [formNotes, setFormNotes] = useState("")
  const [autoPost, setAutoPost] = useState(true)
  const [saving, setSaving] = useState(false)
  const [posting, setPosting] = useState<string | null>(null)

  // Mark paid modal
  const [payingProvision, setPayingProvision] = useState<CITProvision | null>(null)
  const [payDate, setPayDate] = useState(new Date().toISOString().split("T")[0])
  const [payAccount, setPayAccount] = useState("1010")
  const [payRef, setPayRef] = useState("")
  const [paying, setPaying] = useState(false)

  const currentYear = new Date().getFullYear()
  const currentQ = Math.ceil((new Date().getMonth() + 1) / 3)

  const rateInfo = CIT_RATES[citRateCode] ?? CIT_RATES.standard_25
  const isPresumptive = citRateCode === "presumptive_3"

  useEffect(() => { loadData() }, [])

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

      // Load business cit_rate_code from profile
      const profileRes = await fetch(`/api/business/profile?business_id=${business.id}`)
      if (profileRes.ok) {
        const profileData = await profileRes.json()
        const rateCode = profileData.business?.cit_rate_code || "standard_25"
        setCitRateCode(rateCode)
        setCitRate(CIT_RATES[rateCode]?.rate ?? 0.25)
      }

      const res = await fetch(`/api/cit?business_id=${business.id}`)
      const data = await res.json()
      setProvisions(data.provisions ?? [])
      setPeriodLabel(`Q${currentQ} ${currentYear}`)
    } finally {
      setLoading(false)
    }
  }

  const fetchPL = async () => {
    if (!businessId) return
    setPlLoading(true)
    setPlError("")
    try {
      const yearStart = `${currentYear}-01-01`
      const yearEnd = `${currentYear}-12-31`
      const res = await fetch(
        `/api/accounting/reports/profit-and-loss?business_id=${businessId}&start_date=${yearStart}&end_date=${yearEnd}`
      )
      if (!res.ok) {
        setPlError("Could not load P&L data. Please try again.")
        return
      }
      const data = await res.json()

      if (isPresumptive) {
        // For presumptive tax: base is gross revenue (income sections)
        const incomeSection = data.sections?.find((s: any) => s.key === "income")
        const otherIncomeSection = data.sections?.find((s: any) => s.key === "other_income")
        const grossRevenue =
          (incomeSection?.subtotal ?? 0) + (otherIncomeSection?.subtotal ?? 0)
        setNetProfit(grossRevenue)
        setChargeableIncome(Math.max(0, grossRevenue).toFixed(2))
      } else {
        // For standard CIT: base is net profit before tax
        const profit = data.net_profit ?? data.totals?.net_profit ?? null
        if (profit != null) {
          setNetProfit(Number(profit))
          setChargeableIncome(Math.max(0, Number(profit)).toFixed(2))
        } else {
          setPlError("P&L data format not recognised. Please enter income manually.")
        }
      }
    } finally {
      setPlLoading(false)
    }
  }

  const citAmount = Math.round(Math.max(0, Number(chargeableIncome) || 0) * citRate * 100) / 100
  const currency = resolveCurrencyDisplay({ currency_symbol: currencySymbol, currency_code: currencyCode })

  const handleCreate = async () => {
    if (!periodLabel.trim()) {
      toast.showToast("Please enter a period label (e.g. Q1 2026)", "warning")
      return
    }
    if (!chargeableIncome || Number(chargeableIncome) < 0) {
      toast.showToast(`Please enter the ${isPresumptive ? "gross turnover" : "chargeable income"}`, "warning")
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/cit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id:       businessId,
          period_label:      periodLabel.trim(),
          provision_type:    provType,
          chargeable_income: Number(chargeableIncome),
          cit_rate:          citRate,
          notes:             formNotes || null,
          auto_post:         autoPost,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.showToast(data.error || "Failed to create provision", "error")
        return
      }
      toast.showToast(
        `CIT provision ${currency}${citAmount.toFixed(2)} created${autoPost ? " and posted to ledger" : ""}`,
        "success"
      )
      setShowForm(false)
      setChargeableIncome("")
      setFormNotes("")
      await loadData()
    } finally {
      setSaving(false)
    }
  }

  const handlePost = async (provisionId: string) => {
    setPosting(provisionId)
    try {
      const res = await fetch("/api/cit?action=post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provision_id: provisionId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.showToast(data.error || "Failed to post to ledger", "error")
        return
      }
      toast.showToast("CIT provision posted to ledger", "success")
      await loadData()
    } finally {
      setPosting(null)
    }
  }

  const handleMarkPaid = async () => {
    if (!payingProvision) return
    setPaying(true)
    try {
      const res = await fetch("/api/cit?action=pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id:           businessId,
          provision_id:          payingProvision.id,
          payment_account_code:  payAccount,
          payment_date:          payDate,
          payment_ref:           payRef.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.showToast(data.error || "Failed to mark as paid", "error")
        return
      }
      toast.showToast(`CIT payment of ${currency}${payingProvision.cit_amount.toFixed(2)} posted to ledger`, "success")
      setPayingProvision(null)
      setPayRef("")
      await loadData()
    } finally {
      setPaying(false)
    }
  }

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      draft:  "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
      posted: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
      paid:   "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    }
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? map.draft}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    )
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="p-6"><p className="text-gray-500">Loading CIT data…</p></div>
      </ProtectedLayout>
    )
  }

  const totalPosted = provisions.filter(p => p.status !== "draft").reduce((s, p) => s + p.cit_amount, 0)
  const totalPaid   = provisions.filter(p => p.status === "paid").reduce((s, p) => s + p.cit_amount, 0)
  const activeRate  = CIT_RATES[citRateCode] ?? CIT_RATES.standard_25

  return (
    <ProtectedLayout>
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
                <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                  Corporate Income Tax
                </h1>
                <p className="text-gray-600 dark:text-gray-400 mt-1">
                  CIT provisions and quarterly payments · {activeRate.label}
                </p>
              </div>
              <button
                onClick={() => { setCitRate(rateInfo.rate); setShowForm(true) }}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-5 py-2.5 rounded-lg hover:from-blue-700 hover:to-indigo-700 font-medium shadow-lg transition-all flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Provision
              </button>
            </div>
          </div>

          {/* Info Banner */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-4 mb-6">
            <div className="flex gap-3">
              <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm text-blue-800 dark:text-blue-300">
                <p className="font-semibold mb-1">Ghana CIT — Key Facts</p>
                <ul className="list-disc list-inside space-y-0.5 text-xs">
                  <li>Your rate: <strong>{activeRate.label}</strong> · calculated on {activeRate.basis === "turnover" ? "gross turnover" : "net profit (chargeable income)"}</li>
                  <li>Quarterly provisional payments due by end of each quarter (Mar 31, Jun 30, Sep 30, Dec 31)</li>
                  <li>Final annual assessment based on audited accounts, filed within 4 months of year end</li>
                  <li>Posting a provision: Dr Income Tax Expense (9000) / Cr CIT Payable (2160)</li>
                  <li>Paying GRA: Dr CIT Payable (2160) / Cr Bank (1010)</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Summary Cards */}
          {provisions.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 shadow">
                <p className="text-sm text-gray-500 dark:text-gray-400">Total Provisions ({currentYear})</p>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                  {currency}{provisions
                    .filter(p => p.period_label.includes(String(currentYear)))
                    .reduce((s, p) => s + p.cit_amount, 0).toFixed(2)}
                </p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 shadow">
                <p className="text-sm text-gray-500 dark:text-gray-400">Posted to Ledger</p>
                <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                  {currency}{totalPosted.toFixed(2)}
                </p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 shadow">
                <p className="text-sm text-gray-500 dark:text-gray-400">Paid to GRA</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
                  {currency}{totalPaid.toFixed(2)}
                </p>
              </div>
            </div>
          )}

          {/* Provisions Table */}
          {provisions.length === 0 ? (
            <div className="text-center py-16 text-gray-400 dark:text-gray-500">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M12 7h.01M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p>No CIT provisions yet.</p>
              <p className="text-sm mt-1">Create your first quarterly provision to get started.</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Period</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Type</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                      {isPresumptive ? "Turnover" : "Chargeable Income"}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Rate</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">CIT Amount</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {provisions.map(prov => (
                    <tr key={prov.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-sm text-gray-900 dark:text-white">{prov.period_label}</p>
                        <p className="text-xs text-gray-400">{new Date(prov.created_at).toLocaleDateString("en-GB")}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 capitalize">{prov.provision_type}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                        {currency}{Number(prov.chargeable_income).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-400">
                        {(prov.cit_rate * 100).toFixed(0)}%
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-bold text-blue-600 dark:text-blue-400">
                        {currency}{Number(prov.cit_amount).toFixed(2)}
                      </td>
                      <td className="px-4 py-3">{statusBadge(prov.status)}</td>
                      <td className="px-4 py-3">
                        {prov.status === "draft" && (
                          <button
                            onClick={() => handlePost(prov.id)}
                            disabled={posting === prov.id}
                            className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition-all"
                          >
                            {posting === prov.id ? "Posting…" : "Post to Ledger"}
                          </button>
                        )}
                        {prov.status === "posted" && (
                          <button
                            onClick={() => {
                              setPayingProvision(prov)
                              setPayDate(new Date().toISOString().split("T")[0])
                              setPayRef("")
                            }}
                            className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 font-medium transition-all"
                          >
                            Mark Paid
                          </button>
                        )}
                        {prov.status === "paid" && (
                          <span className="text-xs text-green-600 dark:text-green-400 font-medium">✓ Paid to GRA</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* New Provision Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">New CIT Provision</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              Creates a CIT provision entry for the selected period.
            </p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Period *</label>
                  <input
                    type="text"
                    value={periodLabel}
                    onChange={e => setPeriodLabel(e.target.value)}
                    placeholder={`Q${currentQ} ${currentYear}`}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Type</label>
                  <select
                    value={provType}
                    onChange={e => setProvType(e.target.value as any)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="quarterly">Quarterly Provisional</option>
                    <option value="annual">Annual Estimate</option>
                    <option value="final">Final Assessment</option>
                  </select>
                </div>
              </div>

              {/* P&L Quick Fetch */}
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-300">
                    Auto-fill from {isPresumptive ? "Revenue" : "P&L"}
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-400">
                    Pulls YTD {isPresumptive ? "gross revenue" : "net profit"} for {currentYear}
                    {netProfit != null && ` → ${currency}${netProfit.toFixed(2)}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={fetchPL}
                  disabled={plLoading}
                  className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium flex items-center gap-1.5"
                >
                  {plLoading ? (
                    <>
                      <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Loading…
                    </>
                  ) : "Fetch"}
                </button>
              </div>
              {plError && <p className="text-xs text-red-600 dark:text-red-400">{plError}</p>}

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  {isPresumptive ? "Gross Turnover *" : "Chargeable Income *"}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={chargeableIncome}
                  onChange={e => setChargeableIncome(e.target.value)}
                  onFocus={e => e.target.select()}
                  placeholder="0.00"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {isPresumptive
                    ? "Total gross revenue before any deductions"
                    : "Net profit before CIT, after all allowable deductions"}
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">CIT Rate</label>
                <select
                  value={citRate}
                  onChange={e => setCitRate(Number(e.target.value))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                >
                  {Object.entries(CIT_RATES).map(([code, info]) => (
                    <option key={code} value={info.rate}>{info.label}</option>
                  ))}
                </select>
              </div>

              {/* CIT Preview */}
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Computed CIT</p>
                  <p className="text-xs text-gray-400">
                    {currency}{(Number(chargeableIncome) || 0).toFixed(2)} × {(citRate * 100).toFixed(0)}%
                  </p>
                </div>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {currency}{citAmount.toFixed(2)}
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Notes</label>
                <textarea
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  rows={2}
                  placeholder="Optional notes..."
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoPost}
                  onClick={() => setAutoPost(!autoPost)}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${autoPost ? "bg-blue-600" : "bg-gray-200 dark:bg-gray-600"}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${autoPost ? "translate-x-4" : "translate-x-0"}`} />
                </button>
                <span className="text-sm text-gray-700 dark:text-gray-300">Post to ledger immediately</span>
              </label>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || !periodLabel || !chargeableIncome}
                className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-2 rounded-lg hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 font-medium text-sm shadow flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Saving…
                  </>
                ) : (
                  `Create Provision · ${currency}${citAmount.toFixed(2)}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mark Paid Modal */}
      {payingProvision && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Record CIT Payment to GRA</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              {payingProvision.period_label} · {currency}{payingProvision.cit_amount.toFixed(2)}
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Payment Date *</label>
                <input
                  type="date"
                  value={payDate}
                  onChange={e => setPayDate(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 dark:bg-gray-700 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Payment Account</label>
                <select
                  value={payAccount}
                  onChange={e => setPayAccount(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 dark:bg-gray-700 dark:text-white"
                >
                  <option value="1010">Bank Account</option>
                  <option value="1000">Cash</option>
                  <option value="1020">Mobile Money</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">GRA Receipt Reference</label>
                <input
                  type="text"
                  value={payRef}
                  onChange={e => setPayRef(e.target.value)}
                  placeholder="GRA receipt number (optional)"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 dark:bg-gray-700 dark:text-white"
                />
              </div>

              {/* Preview */}
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-xs text-green-800 dark:text-green-300 space-y-0.5">
                <p className="font-semibold">Journal entry will post:</p>
                <p>Dr CIT Payable (2160) {currency}{payingProvision.cit_amount.toFixed(2)}</p>
                <p>Cr {payAccount === "1010" ? "Bank" : payAccount === "1020" ? "Mobile Money" : "Cash"} {currency}{payingProvision.cit_amount.toFixed(2)}</p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setPayingProvision(null)}
                className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleMarkPaid}
                disabled={paying || !payDate}
                className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 text-white px-4 py-2 rounded-lg hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 font-medium text-sm shadow flex items-center justify-center gap-2"
              >
                {paying ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Posting…
                  </>
                ) : "Confirm Payment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ProtectedLayout>
  )
}
