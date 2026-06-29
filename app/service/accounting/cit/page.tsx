"use client"

import { Fragment, useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { formatMoney } from "@/lib/money"
import { useToast } from "@/components/ui/ToastProvider"
import TierGate from "@/components/service/TierGate"
import { NativeSelect } from "@/components/ui/NativeSelect"
import { useServiceFinancialWrite } from "@/components/service/useServiceFinancialWrite"
import ServiceReadOnlyNotice from "@/components/service/ServiceReadOnlyNotice"
import {
  GHANA_CIT_RATE_OPTIONS,
  buildGhanaCitPeriod,
  calculateGhanaCitAmount,
  parseGhanaCitPeriodLabel,
  resolveGhanaCitRate,
  type GhanaCitProvisionType,
  type GhanaCitRateCode,
} from "@/lib/tax/ghanaCit"

/** Used for auto-fetch: quarterly needs Q# YYYY; annual/final needs FY YYYY (or plain YYYY if legacy). */
function periodLabelIsCompleteForFetch(
  label: string,
  provType: "quarterly" | "annual" | "final"
): boolean {
  const t = label.trim()
  if (provType === "quarterly") return /^Q[1-4]\s+\d{4}$/i.test(t)
  return /^FY\s+\d{4}$/i.test(t) || /^\d{4}$/.test(t)
}

function buildQuarterSelectOptions(fromYear: number, toYear: number): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = []
  for (let y = toYear; y >= fromYear; y--) {
    for (let q = 4; q >= 1; q--) {
      out.push({ value: `Q${q} ${y}`, label: `Q${q} ${y}` })
    }
  }
  return out
}

function buildFinancialYearOptions(fromYear: number, toYear: number): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = []
  for (let y = toYear; y >= fromYear; y--) {
    out.push({ value: `FY ${y}`, label: `FY ${y} (full year)` })
  }
  return out
}

type CITProvision = {
  id: string
  period_label: string
  provision_type: GhanaCitProvisionType
  chargeable_income: number
  cit_rate: number
  cit_amount: number
  add_backs_total: number
  deductions_total: number
  gross_revenue: number
  status: "draft" | "posted" | "paid"
  journal_entry_id: string | null
  fiscal_year: number | null
  quarter: number | null
  period_start: string | null
  period_end: string | null
  due_date: string | null
  profit_before_tax: number | null
  notes: string | null
  created_at: string
}

type CITAdjustment = {
  id: string
  adjustment_type: "add_back" | "deduction"
  category: string
  amount: number
  notes: string | null
  account_id: string | null
  accounts?: { id: string; code: string; name: string } | null
}

const ADD_BACK_CATEGORIES = [
  "Non-deductible expense",
  "Personal/private expense",
  "Penalty or fine",
  "Capital expense expensed",
  "Unsupported expense",
  "Other add-back",
]

const DEDUCTION_CATEGORIES = [
  "Capital allowance",
  "Approved deduction",
  "Loss relief",
  "Tax credit / relief",
  "Other deduction",
]

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not set"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export default function CITPage() {
  const router = useRouter()
  const toast = useToast()
  const { readOnly } = useServiceFinancialWrite("accounting")

  const [businessId, setBusinessId] = useState("")
  const [currencyCode, setCurrencyCode] = useState("")
  const [citRateCode, setCitRateCode] = useState<GhanaCitRateCode>("standard_25")
  const [loading, setLoading] = useState(true)
  const [provisions, setProvisions] = useState<CITProvision[]>([])
  const [expandedProvisionId, setExpandedProvisionId] = useState<string | null>(null)
  const [adjustmentsByProvision, setAdjustmentsByProvision] = useState<Record<string, CITAdjustment[]>>({})
  const [adjustmentsLoading, setAdjustmentsLoading] = useState<string | null>(null)
  const [adjustmentSaving, setAdjustmentSaving] = useState(false)
  const [adjustmentForm, setAdjustmentForm] = useState({
    adjustment_type: "add_back" as "add_back" | "deduction",
    category: ADD_BACK_CATEGORIES[0],
    amount: "",
    notes: "",
  })

  // P&L summary
  const [plLoading, setPlLoading] = useState(false)
  const [netProfit, setNetProfit] = useState<number | null>(null)
  const [grossRevenue, setGrossRevenue] = useState("")   // for AMT calculation
  const [plError, setPlError] = useState("")

  // New provision form
  const [showForm, setShowForm] = useState(false)
  const [periodLabel, setPeriodLabel] = useState("")
  const [provType, setProvType] = useState<GhanaCitProvisionType>("quarterly")
  const [chargeableIncome, setChargeableIncome] = useState("")
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

  const rateInfo = resolveGhanaCitRate(citRateCode)
  const isPresumptive = rateInfo.code === "presumptive_3"

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) return

      setBusinessId(business.id)
      setCurrencyCode(business.default_currency || "")

      // Load business cit_rate_code from profile
      const profileRes = await fetch(`/api/business/profile?business_id=${business.id}`)
      if (profileRes.ok) {
        const profileData = await profileRes.json()
        const resolvedRate = resolveGhanaCitRate(profileData.business?.cit_rate_code)
        setCitRateCode(resolvedRate.code)
      }

      const res = await fetch(`/api/cit?business_id=${business.id}`)
      const data = await res.json()
      setProvisions(data.provisions ?? [])
      setPeriodLabel(`Q${currentQ} ${currentYear}`)
    } finally {
      setLoading(false)
    }
  }

  const replaceProvision = (updatedProvision: CITProvision) => {
    setProvisions((current) => current.map((p) => (p.id === updatedProvision.id ? updatedProvision : p)))
  }

  const loadAdjustments = async (provisionId: string) => {
    setAdjustmentsLoading(provisionId)
    try {
      const res = await fetch(`/api/cit/adjustments?provision_id=${encodeURIComponent(provisionId)}`)
      const data = await res.json()
      if (!res.ok) {
        toast.showToast(data.error || "Failed to load CIT adjustments", "error")
        return
      }
      setAdjustmentsByProvision((current) => ({
        ...current,
        [provisionId]: data.adjustments ?? [],
      }))
    } finally {
      setAdjustmentsLoading(null)
    }
  }

  const toggleAdjustments = async (provisionId: string) => {
    const next = expandedProvisionId === provisionId ? null : provisionId
    setExpandedProvisionId(next)
    if (next && !adjustmentsByProvision[next]) {
      await loadAdjustments(next)
    }
  }

  const handleAdjustmentTypeChange = (value: "add_back" | "deduction") => {
    setAdjustmentForm({
      adjustment_type: value,
      category: value === "add_back" ? ADD_BACK_CATEGORIES[0] : DEDUCTION_CATEGORIES[0],
      amount: "",
      notes: "",
    })
  }

  const handleAddAdjustment = async (provision: CITProvision) => {
    if (!adjustmentForm.amount || Number(adjustmentForm.amount) <= 0) {
      toast.showToast("Adjustment amount must be greater than zero", "warning")
      return
    }
    setAdjustmentSaving(true)
    try {
      const res = await fetch("/api/cit/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provision_id: provision.id,
          adjustment_type: adjustmentForm.adjustment_type,
          category: adjustmentForm.category,
          amount: Number(adjustmentForm.amount),
          notes: adjustmentForm.notes.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.showToast(data.error || "Failed to save CIT adjustment", "error")
        return
      }
      if (data.provision) replaceProvision(data.provision)
      setAdjustmentForm({
        adjustment_type: "add_back",
        category: ADD_BACK_CATEGORIES[0],
        amount: "",
        notes: "",
      })
      await loadAdjustments(provision.id)
      toast.showToast("CIT adjustment saved", "success")
    } finally {
      setAdjustmentSaving(false)
    }
  }

  const handleDeleteAdjustment = async (provision: CITProvision, adjustmentId: string) => {
    setAdjustmentSaving(true)
    try {
      const res = await fetch(`/api/cit/adjustments/${encodeURIComponent(adjustmentId)}`, {
        method: "DELETE",
      })
      const data = await res.json()
      if (!res.ok) {
        toast.showToast(data.error || "Failed to delete CIT adjustment", "error")
        return
      }
      if (data.provision) replaceProvision(data.provision)
      await loadAdjustments(provision.id)
      toast.showToast("CIT adjustment deleted", "success")
    } finally {
      setAdjustmentSaving(false)
    }
  }

  const fetchPL = useCallback(async () => {
    if (!businessId) return
    setPlLoading(true)
    setPlError("")
    try {
      let startDate: string
      let endDate: string
      const period = buildGhanaCitPeriod({
        provisionType: provType,
        periodLabel,
        fallbackYear: currentYear,
        fallbackQuarter: currentQ,
      })
      startDate = period.periodStart
      endDate = period.periodEnd
      const res = await fetch(
        `/api/accounting/reports/profit-and-loss?business_id=${encodeURIComponent(businessId)}&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`
      )
      if (!res.ok) {
        let msg = "Could not load P&L data. Please try again."
        try {
          const errBody = await res.json()
          if (typeof errBody?.error === "string" && errBody.error.trim()) {
            msg = errBody.error
          }
        } catch {
          /* ignore */
        }
        setPlError(msg)
        return
      }
      const data = await res.json()

      // Always extract gross revenue (income + other_income) for AMT
      const incomeSection      = data.sections?.find((s: any) => s.key === "income")
      const otherIncomeSection = data.sections?.find((s: any) => s.key === "other_income")
      const grossRev = (incomeSection?.subtotal ?? 0) + (otherIncomeSection?.subtotal ?? 0)

      if (isPresumptive) {
        // For presumptive tax: base is gross revenue (income sections)
        setNetProfit(grossRev)
        setChargeableIncome(Math.max(0, grossRev).toFixed(2))
        setGrossRevenue(Math.max(0, grossRev).toFixed(2))
      } else {
        // For standard CIT: base is profit BEFORE income tax (chargeable income)
        // Use profit_before_tax (excludes taxes/CIT section) to avoid circular deduction.
        // Fall back to net_profit only if profit_before_tax is absent (older API).
        const pbt = data.totals?.profit_before_tax ?? null
        const profit = pbt ?? data.totals?.net_profit ?? data.net_profit ?? null
        if (profit != null) {
          setNetProfit(Number(profit))
          setChargeableIncome(Math.max(0, Number(profit)).toFixed(2))
        } else {
          setPlError("P&L data format not recognised. Please enter income manually.")
        }
        // Always set gross revenue for AMT even when profit fetch fails
        setGrossRevenue(Math.max(0, grossRev).toFixed(2))
      }
    } finally {
      setPlLoading(false)
    }
  }, [businessId, periodLabel, provType, currentYear, currentQ, isPresumptive])

  // When Period is a full "Q2 2026" (or you change Type), P&L reloads shortly — no need to rely on Fetch alone.
  const plAutoFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!showForm || !businessId || !periodLabelIsCompleteForFetch(periodLabel, provType)) {
      return
    }
    if (plAutoFetchTimer.current) clearTimeout(plAutoFetchTimer.current)
    plAutoFetchTimer.current = setTimeout(() => {
      plAutoFetchTimer.current = null
      void fetchPL()
    }, 650)
    return () => {
      if (plAutoFetchTimer.current) clearTimeout(plAutoFetchTimer.current)
    }
  }, [showForm, businessId, periodLabel, provType, fetchPL])

  const periodYearFrom = currentYear - 3
  const periodYearTo = currentYear + 1
  const quarterOptions = buildQuarterSelectOptions(periodYearFrom, periodYearTo)
  const fyOptions = buildFinancialYearOptions(periodYearFrom, periodYearTo)
  const quarterSelectOptions =
    /^Q[1-4]\s+\d{4}$/i.test(periodLabel) && !quarterOptions.some((o) => o.value === periodLabel)
      ? [{ value: periodLabel, label: periodLabel }, ...quarterOptions]
      : quarterOptions
  const fySelectOptions =
    /^FY\s+\d{4}$/i.test(periodLabel) && !fyOptions.some((o) => o.value === periodLabel.trim().replace(/^fy\s+/i, "FY "))
      ? [
          {
            value: periodLabel.trim().replace(/^fy\s+/i, "FY "),
            label: periodLabel.trim().replace(/^fy\s+/i, "FY "),
          },
          ...fyOptions,
        ]
      : fyOptions

  const isExempt = rateInfo.code === "exempt"
  // AMT = 0.5% of gross revenue; doesn't apply to presumptive (already turnover-based) or exempt.
  const amtApplicable = !isPresumptive && !isExempt
  const {
    standardCit,
    minimumTaxAmount: amtAmount,
    minimumTaxApplies: amtApplies,
    citAmount,
  } = calculateGhanaCitAmount({
    chargeableIncome: Number(chargeableIncome) || 0,
    grossRevenue: Number(grossRevenue) || 0,
    rate: rateInfo,
  })
  const noCitPayable = citAmount <= 0
  const handleCreate = async () => {
    if (!periodLabel.trim()) {
      toast.showToast("Please choose a period", "warning")
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
          gross_revenue:     Number(grossRevenue) || 0,
          profit_before_tax:  isPresumptive ? null : Number(chargeableIncome),
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
        `CIT provision ${formatMoney(citAmount, currencyCode || null)} created${autoPost ? " and posted to ledger" : ""}`,
        "success"
      )
      setShowForm(false)
      setChargeableIncome("")
      setGrossRevenue("")
      setNetProfit(null)
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
      toast.showToast(`CIT payment of ${formatMoney(payingProvision.cit_amount, currencyCode || null)} posted to ledger`, "success")
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
    return <div className="p-6"><p className="text-gray-500">Loading CIT data…</p></div>
  }

  const totalPosted = provisions.filter(p => p.status !== "draft").reduce((s, p) => s + p.cit_amount, 0)
  const totalPaid   = provisions.filter(p => p.status === "paid").reduce((s, p) => s + p.cit_amount, 0)
  const activeRate = rateInfo

  return (
    <TierGate minTier="business">
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
              {!readOnly && (
              <button
                onClick={() => setShowForm(true)}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-5 py-2.5 rounded-lg hover:from-blue-700 hover:to-indigo-700 font-medium shadow-lg transition-all flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Provision
              </button>
              )}
            </div>
          </div>

          {readOnly && <ServiceReadOnlyNotice scope="accounting" className="mb-6" />}

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
                  {formatMoney(
                    provisions
                      .filter(p => p.period_label.includes(String(currentYear)))
                      .reduce((s, p) => s + p.cit_amount, 0),
                    currencyCode || null
                  )}
                </p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 shadow">
                <p className="text-sm text-gray-500 dark:text-gray-400">Posted to Ledger</p>
                <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                  {formatMoney(totalPosted, currencyCode || null)}
                </p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 shadow">
                <p className="text-sm text-gray-500 dark:text-gray-400">Paid to GRA</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
                  {formatMoney(totalPaid, currencyCode || null)}
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
                  {provisions.map(prov => {
                    const adjustments = adjustmentsByProvision[prov.id] ?? []
                    const provisionProfitBeforeTax = Number(prov.profit_before_tax ?? prov.chargeable_income ?? 0)
                    const provisionAddBacks = Number(prov.add_backs_total ?? 0)
                    const provisionDeductions = Number(prov.deductions_total ?? 0)
                    const provisionChargeableIncome = Number(prov.chargeable_income ?? 0)
                    const provisionCitAmount = Number(prov.cit_amount ?? 0)
                    const provisionReadOnly = readOnly || prov.status !== "draft"
                    return (
                    <Fragment key={prov.id}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-sm text-gray-900 dark:text-white">{prov.period_label}</p>
                        <p className="text-xs text-gray-400">
                          {prov.period_start && prov.period_end
                            ? `${formatDate(prov.period_start)} - ${formatDate(prov.period_end)}`
                            : new Date(prov.created_at).toLocaleDateString("en-GB")}
                        </p>
                        {prov.due_date && (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            Due {formatDate(prov.due_date)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 capitalize">{prov.provision_type}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                        {formatMoney(provisionChargeableIncome, currencyCode || null)}
                        {(provisionAddBacks > 0 || provisionDeductions > 0) && (
                          <p className="text-[11px] text-gray-400">
                            Adjusted from {formatMoney(provisionProfitBeforeTax, currencyCode || null)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-400">
                        {(prov.cit_rate * 100).toFixed(0)}%
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-bold text-blue-600 dark:text-blue-400">
                        {formatMoney(provisionCitAmount, currencyCode || null)}
                      </td>
                      <td className="px-4 py-3">{statusBadge(prov.status)}</td>
                      <td className="px-4 py-3 space-y-2">
                        <button
                          onClick={() => toggleAdjustments(prov.id)}
                          className="block text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                        >
                          {expandedProvisionId === prov.id ? "Hide adjustments" : "Adjustments"}
                        </button>
                        {provisionCitAmount <= 0 && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                            No CIT payable
                          </span>
                        )}
                        {!readOnly && provisionCitAmount > 0 && prov.status === "draft" && (
                          <button
                            onClick={() => handlePost(prov.id)}
                            disabled={posting === prov.id}
                            className="block text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition-all"
                          >
                            {posting === prov.id ? "Posting…" : "Post to Ledger"}
                          </button>
                        )}
                        {!readOnly && provisionCitAmount > 0 && prov.status === "posted" && (
                          <button
                            onClick={() => {
                              setPayingProvision(prov)
                              setPayDate(new Date().toISOString().split("T")[0])
                              setPayRef("")
                            }}
                            className="block text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 font-medium transition-all"
                          >
                            Mark Paid
                          </button>
                        )}
                        {provisionCitAmount > 0 && prov.status === "paid" && (
                          <span className="text-xs text-green-600 dark:text-green-400 font-medium">✓ Paid to GRA</span>
                        )}
                      </td>
                    </tr>
                    {expandedProvisionId === prov.id && (
                      <tr>
                        <td colSpan={7} className="bg-slate-50 dark:bg-slate-900/40 px-6 py-5">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                                  Structured CIT Adjustments
                                </h3>
                                {adjustmentsLoading === prov.id && (
                                  <span className="text-xs text-gray-500">Loading...</span>
                                )}
                              </div>
                              {provisionReadOnly && (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                                  Adjustments are read-only after posting/payment. Reverse or create a new provision if a correction is needed.
                                </div>
                              )}
                              {adjustments.length === 0 ? (
                                <p className="text-xs text-gray-500 dark:text-gray-400">No adjustments recorded.</p>
                              ) : (
                                <div className="space-y-2">
                                  {adjustments.map((adj) => (
                                    <div
                                      key={adj.id}
                                      className="rounded-lg border border-gray-200 bg-white p-3 text-xs dark:border-gray-700 dark:bg-gray-800"
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div>
                                          <p className="font-semibold text-gray-900 dark:text-white">
                                            {adj.adjustment_type === "add_back" ? "Add-back" : "Deduction"} · {adj.category}
                                          </p>
                                          {adj.notes && (
                                            <p className="mt-1 text-gray-500 dark:text-gray-400">{adj.notes}</p>
                                          )}
                                        </div>
                                        <div className="text-right">
                                          <p className={adj.adjustment_type === "add_back" ? "font-bold text-blue-600" : "font-bold text-green-600"}>
                                            {adj.adjustment_type === "add_back" ? "+" : "-"}
                                            {formatMoney(Number(adj.amount), currencyCode || null)}
                                          </p>
                                          {!provisionReadOnly && (
                                            <button
                                              onClick={() => handleDeleteAdjustment(prov, adj.id)}
                                              disabled={adjustmentSaving}
                                              className="mt-1 text-[11px] text-red-600 hover:underline disabled:opacity-50"
                                            >
                                              Delete
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {!provisionReadOnly && (
                                <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                    Add Adjustment
                                  </h4>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <NativeSelect
                                      value={adjustmentForm.adjustment_type}
                                      onChange={(e) => handleAdjustmentTypeChange(e.target.value as "add_back" | "deduction")}
                                      size="sm"
                                    >
                                      <option value="add_back">Add-back</option>
                                      <option value="deduction">Deduction</option>
                                    </NativeSelect>
                                    <NativeSelect
                                      value={adjustmentForm.category}
                                      onChange={(e) => setAdjustmentForm((current) => ({ ...current, category: e.target.value }))}
                                      size="sm"
                                    >
                                      {(adjustmentForm.adjustment_type === "add_back" ? ADD_BACK_CATEGORIES : DEDUCTION_CATEGORIES).map((category) => (
                                        <option key={category} value={category}>{category}</option>
                                      ))}
                                    </NativeSelect>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      value={adjustmentForm.amount}
                                      onChange={(e) => setAdjustmentForm((current) => ({ ...current, amount: e.target.value }))}
                                      placeholder="Amount"
                                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                    />
                                    <input
                                      type="text"
                                      value={adjustmentForm.notes}
                                      onChange={(e) => setAdjustmentForm((current) => ({ ...current, notes: e.target.value }))}
                                      placeholder="Optional notes"
                                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                    />
                                  </div>
                                  <button
                                    onClick={() => handleAddAdjustment(prov)}
                                    disabled={adjustmentSaving}
                                    className="mt-3 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                                  >
                                    {adjustmentSaving ? "Saving..." : "Save Adjustment"}
                                  </button>
                                </div>
                              )}
                            </div>

                            <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm dark:border-gray-700 dark:bg-gray-800">
                              <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">Calculation Summary</h3>
                              <div className="space-y-2">
                                <div className="flex justify-between text-gray-600 dark:text-gray-300">
                                  <span>Profit before tax</span>
                                  <span>{formatMoney(provisionProfitBeforeTax, currencyCode || null)}</span>
                                </div>
                                <div className="flex justify-between text-blue-600 dark:text-blue-400">
                                  <span>Add-backs total</span>
                                  <span>{formatMoney(provisionAddBacks, currencyCode || null)}</span>
                                </div>
                                <div className="flex justify-between text-green-600 dark:text-green-400">
                                  <span>Deductions total</span>
                                  <span>{formatMoney(provisionDeductions, currencyCode || null)}</span>
                                </div>
                                <div className="border-t border-gray-200 pt-2 flex justify-between font-semibold text-gray-900 dark:border-gray-700 dark:text-white">
                                  <span>Chargeable income</span>
                                  <span>{formatMoney(provisionChargeableIncome, currencyCode || null)}</span>
                                </div>
                                <div className="flex justify-between text-gray-600 dark:text-gray-300">
                                  <span>CIT rate</span>
                                  <span>{(Number(prov.cit_rate) * 100).toFixed(0)}%</span>
                                </div>
                                <div className="flex justify-between text-gray-600 dark:text-gray-300">
                                  <span>Gross revenue for AMT</span>
                                  <span>{formatMoney(Number(prov.gross_revenue ?? 0), currencyCode || null)}</span>
                                </div>
                                <div className="border-t border-gray-200 pt-2 flex justify-between text-base font-bold text-blue-600 dark:border-gray-700 dark:text-blue-400">
                                  <span>CIT amount</span>
                                  <span>{formatMoney(provisionCitAmount, currencyCode || null)}</span>
                                </div>
                                {provisionCitAmount <= 0 && (
                                  <p className="rounded-lg bg-green-50 p-2 text-xs text-green-700 dark:bg-green-900/20 dark:text-green-300">
                                    No CIT payable for this period.
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* New Provision Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">New CIT Provision</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              Creates a CIT provision entry for the selected period.
            </p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Period *</label>
                  {provType === "quarterly" ? (
                    <NativeSelect
                      value={quarterSelectOptions.some((o) => o.value === periodLabel) ? periodLabel : `Q${currentQ} ${currentYear}`}
                      onChange={(e) => setPeriodLabel(e.target.value)}
                      size="sm"
                    >
                      {quarterSelectOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <NativeSelect
                      value={
                        /^FY\s+\d{4}$/i.test(periodLabel.trim())
                          ? periodLabel.trim().replace(/^fy\s+/i, "FY ")
                          : `FY ${parseGhanaCitPeriodLabel(periodLabel, currentYear, currentQ).year}`
                      }
                      onChange={(e) => setPeriodLabel(e.target.value)}
                      size="sm"
                    >
                      {fySelectOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Type</label>
                  <NativeSelect
                    value={provType}
                    onChange={(e) => {
                      const next = e.target.value as GhanaCitProvisionType
                      const { year } = parseGhanaCitPeriodLabel(periodLabel, currentYear, currentQ)
                      setProvType(next)
                      if (next === "quarterly") {
                        const q = year === currentYear ? currentQ : 1
                        setPeriodLabel(`Q${q} ${year}`)
                      } else {
                        setPeriodLabel(`FY ${year}`)
                      }
                    }}
                    size="sm"
                  >
                    <option value="quarterly">Quarterly Provisional</option>
                    <option value="annual">Annual Estimate</option>
                    <option value="final">Final Assessment</option>
                  </NativeSelect>
                </div>
              </div>

              {/* P&L Quick Fetch */}
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-300">
                    Auto-fill from {isPresumptive ? "Revenue" : "P&L"}
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-400">
                    Changing Period or Type reloads P&amp;L after a short pause. Use <strong>Fetch</strong> for an immediate refresh.
                  </p>
                  <p className="text-xs text-blue-700/90 dark:text-blue-400/90 mt-1">
                    Pulls {provType === "quarterly"
                      ? (periodLabel.trim() || `Q${currentQ} ${currentYear}`)
                      : `full year ${parseGhanaCitPeriodLabel(periodLabel, currentYear, currentQ).year}`
                    } {isPresumptive ? "gross revenue" : "profit before tax"}
                    {netProfit != null && ` → ${formatMoney(netProfit, currencyCode || null)}`}
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

              {/* Gross Revenue field — needed for AMT (0.5% of revenue floor) */}
              {amtApplicable && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Gross Revenue <span className="text-xs font-normal text-gray-500">(for AMT calculation)</span>
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={grossRevenue}
                    onChange={e => setGrossRevenue(e.target.value)}
                    onFocus={e => e.target.select()}
                    placeholder="0.00"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Total income before expenses — auto-filled when you click Fetch above
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">CIT Rate</label>
                <NativeSelect
                  value={citRateCode}
                  onChange={() => undefined}
                  disabled
                  size="sm"
                >
                  {GHANA_CIT_RATE_OPTIONS.map((info) => (
                    <option key={info.code} value={info.code}>{info.label}</option>
                  ))}
                </NativeSelect>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Rate is derived from Business Profile tax settings and enforced again on the server.
                </p>
              </div>

              {/* CIT Preview */}
              <div className={`rounded-lg p-4 ${
                noCitPayable
                  ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700"
                  : amtApplies
                    ? "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700"
                    : "bg-gray-50 dark:bg-gray-700"
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {noCitPayable ? "No CIT payable for this period." : amtApplies ? "Minimum Tax (AMT)" : "Computed CIT"}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {noCitPayable
                        ? "No provision or payment journal entry is required."
                        : amtApplies
                        ? `0.5% × ${formatMoney(Number(grossRevenue) || 0, currencyCode || null)} gross revenue`
                        : `${formatMoney(Number(chargeableIncome) || 0, currencyCode || null)} × ${(rateInfo.rate * 100).toFixed(0)}%`}
                    </p>
                  </div>
                  <p className={`text-2xl font-bold ${
                    noCitPayable
                      ? "text-green-600 dark:text-green-400"
                      : amtApplies
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-blue-600 dark:text-blue-400"
                  }`}>
                    {formatMoney(citAmount, currencyCode || null)}
                  </p>
                </div>
                {!noCitPayable && amtApplies && (
                  <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-700 flex justify-between text-xs text-amber-700 dark:text-amber-400">
                    <span>Standard CIT ({(rateInfo.rate * 100).toFixed(0)}% × chargeable income)</span>
                    <span>{formatMoney(standardCit, currencyCode || null)}</span>
                  </div>
                )}
                {!noCitPayable && amtApplicable && !amtApplies && amtAmount > 0 && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    AMT floor: {formatMoney(amtAmount, currencyCode || null)} — standard CIT is higher ✓
                  </p>
                )}
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

              {!noCitPayable && (
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
              )}
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
                  noCitPayable
                    ? "Save No CIT Payable"
                    : `Create Provision · ${formatMoney(citAmount, currencyCode || null)}`
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
              {payingProvision.period_label} · {formatMoney(payingProvision.cit_amount, currencyCode || null)}
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
                <NativeSelect value={payAccount} onChange={e => setPayAccount(e.target.value)} size="sm">
                  <option value="1010">Bank Account</option>
                  <option value="1000">Cash</option>
                  <option value="1020">Mobile Money</option>
                </NativeSelect>
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
                <p>Dr CIT Payable (2160) {formatMoney(payingProvision.cit_amount, currencyCode || null)}</p>
                <p>Cr {payAccount === "1010" ? "Bank" : payAccount === "1020" ? "Mobile Money" : "Cash"} {formatMoney(payingProvision.cit_amount, currencyCode || null)}</p>
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
    </TierGate>
  )
}
