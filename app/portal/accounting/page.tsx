"use client"

import { useState, useEffect, useCallback } from "react"
import { useSearchParams, usePathname } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { supabase } from "@/lib/supabaseClient"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { formatCurrencySafe } from "@/lib/currency/formatCurrency"

type ResolvedPeriod = {
  period_id: string
  period_start: string
  period_end: string
}

type Account = { id: string; code: string; name: string; type: string }

type PnlData = {
  period: { period_start: string; period_end: string }
  revenue: { accounts: Array<{ id: string; code: string; name: string; period_total: number }>; total: number }
  expenses: { accounts: Array<{ id: string; code: string; name: string; period_total: number }>; total: number }
  netProfit: number
  profitMargin: number
}

type BalanceSheetData = {
  as_of_date: string
  period: { period_start: string; period_end: string }
  assets: Array<{ id: string; code: string; name: string; type: string; balance: number }>
  liabilities: Array<{ id: string; code: string; name: string; type: string; balance: number }>
  equity: Array<{ id: string; code: string; name: string; type: string; balance: number }>
  totals: {
    totalAssets: number
    totalLiabilities: number
    totalEquity: number
    currentPeriodNetIncome: number
    adjustedEquity: number
    totalLiabilitiesAndEquity: number
    isBalanced: boolean
  }
}

type TrialBalanceRow = {
  account_id: string
  account_code: string
  account_name: string
  account_type: string
  debit_total: number
  credit_total: number
  closing_balance: number
}

type TrialBalanceData = {
  period: { period_start: string; period_end: string }
  accounts: TrialBalanceRow[]
  byType: Record<string, TrialBalanceRow[]>
  totals: {
    totalDebits: number
    totalCredits: number
    totalAssets: number
    totalLiabilities: number
    totalEquity: number
    totalIncome: number
    totalExpenses: number
    netIncome: number
  }
  isBalanced: boolean
}

type GeneralLedgerData = {
  account: { id: string; code: string; name: string; type: string }
  period: { period_start: string; start_date: string; end_date: string }
  lines: Array<{
    entry_date: string
    journal_entry_description: string
    debit: number
    credit: number
    running_balance: number
  }>
  totals: { total_debit: number; total_credit: number; final_balance: number } | null
}

const REPORT_TABS = ["Profit & Loss", "Balance Sheet", "Trial Balance", "General Ledger"] as const
type ReportTab = (typeof REPORT_TABS)[number]

export default function AccountingPortalPage() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [loadingContext, setLoadingContext] = useState(true)
  const [noContext, setNoContext] = useState(false)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [businessName, setBusinessName] = useState<string>("")
  const [periodResolved, setPeriodResolved] = useState<ResolvedPeriod | null>(null)
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [useMonthOnly, setUseMonthOnly] = useState(true)
  const [monthValue, setMonthValue] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  })
  const [loadingResolve, setLoadingResolve] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ReportTab>("Profit & Loss")
  const [loadingReport, setLoadingReport] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)
  const [pnlData, setPnlData] = useState<PnlData | null>(null)
  const [bsData, setBsData] = useState<BalanceSheetData | null>(null)
  const [tbData, setTbData] = useState<TrialBalanceData | null>(null)
  const [glData, setGlData] = useState<GeneralLedgerData | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>("")
  const [loadingCoa, setLoadingCoa] = useState(false)

  const loadContext = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setNoContext(true)
        setBusinessId(null)
        return
      }
      const ctx = await resolveAccountingContext({
        supabase,
        userId: user.id,
        searchParams,
        pathname: pathname ?? undefined,
        source: "portal",
      })
      if ("error" in ctx) {
        setNoContext(true)
        setBusinessId(null)
        return
      }
      setBusinessId(ctx.businessId)
      setBusinessName("Business")
      setNoContext(false)
    } finally {
      setLoadingContext(false)
    }
  }, [])

  useEffect(() => {
    loadContext()
  }, [loadContext])

  const loadCoa = useCallback(async () => {
    if (!businessId || !periodResolved) return
    setLoadingCoa(true)
    try {
      const res = await fetch(`/api/accounting/coa?business_id=${encodeURIComponent(businessId)}`)
      if (!res.ok) {
        if (res.status === 403) {
          setReportError("This area is only available to business owners and authorized staff.")
          return
        }
        setReportError("Failed to load accounts")
        return
      }
      const data = await res.json()
      setAccounts(data.accounts || [])
      setSelectedAccountId("")
    } finally {
      setLoadingCoa(false)
    }
  }, [businessId, periodResolved])

  useEffect(() => {
    if (periodResolved && businessId) loadCoa()
  }, [periodResolved, businessId, loadCoa])

  const resolvePeriod = async () => {
    if (!businessId) {
      setResolveError("Business not found.")
      return
    }
    let from = fromDate
    let to = toDate
    if (useMonthOnly && monthValue) {
      const [y, m] = monthValue.split("-").map(Number)
      const first = new Date(y, m - 1, 1)
      const last = new Date(y, m, 0)
      from = first.toISOString().split("T")[0]
      to = last.toISOString().split("T")[0]
    }
    if (!from) {
      setResolveError("Please select a month or date range.")
      return
    }
    setLoadingResolve(true)
    setResolveError(null)
    setPeriodResolved(null)
    setPnlData(null)
    setBsData(null)
    setTbData(null)
    setGlData(null)
    setReportError(null)
    try {
      const params = new URLSearchParams({
        business_id: businessId,
        from_date: from,
      })
      if (to) params.set("to_date", to)
      const res = await fetch(`/api/accounting/periods/resolve?${params.toString()}`)
      if (res.status === 404) {
        setResolveError("No accounting period covers selected dates.")
        setLoadingResolve(false)
        return
      }
      if (res.status === 403) {
        setResolveError("This area is only available to business owners and authorized staff.")
        setLoadingResolve(false)
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setResolveError((body.error as string) || "Failed to resolve period")
        setLoadingResolve(false)
        return
      }
      const data = await res.json()
      if (!data.period_id || !data.period_start) {
        setResolveError("No accounting period covers selected dates.")
        setLoadingResolve(false)
        return
      }
      setPeriodResolved({
        period_id: data.period_id,
        period_start: data.period_start,
        period_end: data.period_end,
      })
    } catch (e) {
      setResolveError((e as Error).message || "Failed to resolve period")
    } finally {
      setLoadingResolve(false)
    }
  }

  const fetchReport = useCallback(
    async (tab: ReportTab) => {
      if (!businessId || !periodResolved) return
      setLoadingReport(true)
      setReportError(null)
      const base = `/api/accounting/reports`
      const periodStart = periodResolved.period_start
      try {
        if (tab === "Profit & Loss") {
          const res = await fetch(
            `${base}/profit-and-loss?business_id=${encodeURIComponent(businessId)}&period_start=${encodeURIComponent(periodStart)}`
          )
          if (res.status === 403) {
            setReportError("This area is only available to business owners and authorized staff.")
            setLoadingReport(false)
            return
          }
          if (res.status === 500) {
            const body = await res.json().catch(() => ({}))
            const msg = (body.error as string) || ""
            if (msg.includes("Accounting period could not be resolved")) {
              setReportError("DATA ABSENCE: Period could not be resolved. Use Re-resolve period below.")
              setLoadingReport(false)
              return
            }
            setReportError(msg || "Failed to load report")
            setLoadingReport(false)
            return
          }
          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            setReportError((body.error as string) || "Failed to load P&L")
            setLoadingReport(false)
            return
          }
          const data = await res.json()
          const incomeSections = (data.sections ?? []).filter((s: { key: string }) => s.key === "income" || s.key === "other_income")
          const expenseSections = (data.sections ?? []).filter((s: { key: string }) => s.key !== "income" && s.key !== "other_income")
          const revenueAccounts = incomeSections.flatMap((s: { lines: { account_code: string; account_name: string; amount: number }[] }) =>
            s.lines.map((l: { account_code: string; account_name: string; amount: number }) => ({ id: "", code: l.account_code, name: l.account_name, period_total: l.amount }))
          )
          const expenseAccounts = expenseSections.flatMap((s: { lines: { account_code: string; account_name: string; amount: number }[] }) =>
            s.lines.map((l: { account_code: string; account_name: string; amount: number }) => ({ id: "", code: l.account_code, name: l.account_name, period_total: l.amount }))
          )
          const revTotal = incomeSections.reduce((sum: number, s: { subtotal: number }) => sum + s.subtotal, 0)
          const expTotal = expenseSections.reduce((sum: number, s: { subtotal: number }) => sum + s.subtotal, 0)
          setPnlData({
            period: data.period ? { period_start: data.period.period_start, period_end: data.period.period_end } : { period_start: "", period_end: "" },
            revenue: { accounts: revenueAccounts, total: revTotal },
            expenses: { accounts: expenseAccounts, total: expTotal },
            netProfit: data.totals?.net_profit ?? 0,
            profitMargin: revTotal > 0 ? ((data.totals?.net_profit ?? 0) / revTotal) * 100 : 0,
          })
        } else if (tab === "Balance Sheet") {
          const res = await fetch(
            `${base}/balance-sheet?business_id=${encodeURIComponent(businessId)}&period_start=${encodeURIComponent(periodStart)}`
          )
          if (res.status === 403) {
            setReportError("This area is only available to business owners and authorized staff.")
            setLoadingReport(false)
            return
          }
          if (res.status === 500) {
            const body = await res.json().catch(() => ({}))
            const msg = (body.error as string) || ""
            if (msg.includes("Accounting period could not be resolved")) {
              setReportError("DATA ABSENCE: Period could not be resolved. Use Re-resolve period below.")
              setLoadingReport(false)
              return
            }
            setReportError(msg || "Failed to load report")
            setLoadingReport(false)
            return
          }
          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            setReportError((body.error as string) || "Failed to load Balance Sheet")
            setLoadingReport(false)
            return
          }
          const data = await res.json()
          const flattenGroups = (groups: { key: string; lines: { account_code: string; account_name: string; amount: number }[] }[]) =>
            groups.flatMap((g) => g.lines.map((l: { account_code: string; account_name: string; amount: number }) => ({ id: "", code: l.account_code, name: l.account_name, type: "", balance: l.amount })))
          const aSection = (data.sections ?? []).find((s: { key: string }) => s.key === "assets")
          const lSection = (data.sections ?? []).find((s: { key: string }) => s.key === "liabilities")
          const eSection = (data.sections ?? []).find((s: { key: string }) => s.key === "equity")
          setBsData({
            as_of_date: data.as_of_date ?? data.period?.period_end ?? "",
            period: data.period ? { period_start: data.period.period_start, period_end: data.period.period_end } : { period_start: "", period_end: "" },
            assets: aSection ? flattenGroups(aSection.groups ?? []) : [],
            liabilities: lSection ? flattenGroups(lSection.groups ?? []) : [],
            equity: eSection ? flattenGroups(eSection.groups ?? []) : [],
            totals: {
              totalAssets: data.totals?.assets ?? 0,
              totalLiabilities: data.totals?.liabilities ?? 0,
              totalEquity: data.totals?.equity ?? 0,
              currentPeriodNetIncome: 0,
              adjustedEquity: data.totals?.liabilities_plus_equity ? data.totals.liabilities_plus_equity - (data.totals?.liabilities ?? 0) : 0,
              totalLiabilitiesAndEquity: data.totals?.liabilities_plus_equity ?? 0,
              isBalanced: data.totals?.is_balanced ?? true,
            },
          })
        } else if (tab === "Trial Balance") {
          const res = await fetch(
            `${base}/trial-balance?business_id=${encodeURIComponent(businessId)}&period_start=${encodeURIComponent(periodStart)}`
          )
          if (res.status === 403) {
            setReportError("This area is only available to business owners and authorized staff.")
            setLoadingReport(false)
            return
          }
          if (res.status === 500) {
            const body = await res.json().catch(() => ({}))
            const msg = (body.error as string) || ""
            if (msg.includes("Accounting period could not be resolved")) {
              setReportError("DATA ABSENCE: Period could not be resolved. Use Re-resolve period below.")
              setLoadingReport(false)
              return
            }
            setReportError(msg || "Failed to load report")
            setLoadingReport(false)
            return
          }
          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            setReportError((body.error as string) || "Failed to load Trial Balance")
            setLoadingReport(false)
            return
          }
          const data = await res.json()
          setTbData(data)
        } else if (tab === "General Ledger") {
          if (!selectedAccountId) {
            setReportError("Please select an account from the list.")
            setLoadingReport(false)
            return
          }
          const res = await fetch(
            `${base}/general-ledger?business_id=${encodeURIComponent(businessId)}&account_id=${encodeURIComponent(selectedAccountId)}&period_start=${encodeURIComponent(periodStart)}&limit=100`
          )
          if (res.status === 403) {
            setReportError("This area is only available to business owners and authorized staff.")
            setLoadingReport(false)
            return
          }
          if (res.status === 500) {
            const body = await res.json().catch(() => ({}))
            const msg = (body.error as string) || ""
            if (msg.includes("Accounting period could not be resolved")) {
              setReportError("DATA ABSENCE: Period could not be resolved. Use Re-resolve period below.")
              setLoadingReport(false)
              return
            }
            setReportError(msg || "Failed to load General Ledger")
            setLoadingReport(false)
            return
          }
          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            setReportError((body.error as string) || "Failed to load General Ledger")
            setLoadingReport(false)
            return
          }
          const data = await res.json()
          setGlData(data)
        }
      } catch (e) {
        setReportError((e as Error).message || "Failed to load report")
      } finally {
        setLoadingReport(false)
      }
    },
    [businessId, periodResolved, selectedAccountId]
  )

  useEffect(() => {
    if (!periodResolved || activeTab === "General Ledger") return
    fetchReport(activeTab)
  }, [periodResolved, activeTab, fetchReport])

  const handleTabChange = (tab: ReportTab) => {
    setActiveTab(tab)
    setReportError(null)
    if (tab === "General Ledger") {
      setGlData(null)
    }
  }

  const handleLoadGeneralLedger = () => {
    if (!selectedAccountId) {
      setReportError("Please select an account from the list.")
      return
    }
    fetchReport("General Ledger")
  }

  if (loadingContext) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </ProtectedLayout>
    )
  }

  if (noContext) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p className="font-medium text-gray-800 dark:text-gray-200">Client not selected</p>
          <p className="text-gray-600 dark:text-gray-400 mt-1">Use Control Tower or select a client.</p>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 p-4">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              Business reports — read-only. Same data as Accounting workspace. Posting and period actions are not available here.
            </p>
          </div>

          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Accounting Portal</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            View canonical P&L, Balance Sheet, Trial Balance, and General Ledger. Period must be resolved before loading reports.
          </p>

          {businessId && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Business: {businessName || businessId}
            </p>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Period</h2>
            <div className="flex flex-wrap gap-4 items-end">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={useMonthOnly}
                  onChange={() => {
                    setUseMonthOnly(true)
                    setResolveError(null)
                  }}
                  className="rounded"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Month (YYYY-MM)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={!useMonthOnly}
                  onChange={() => {
                    setUseMonthOnly(false)
                    setResolveError(null)
                  }}
                  className="rounded"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Date range</span>
              </label>
            </div>
            <div className="flex flex-wrap gap-4 mt-4">
              {useMonthOnly ? (
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Month</label>
                  <input
                    type="month"
                    value={monthValue}
                    onChange={(e) => {
                      setMonthValue(e.target.value)
                      setResolveError(null)
                    }}
                    className="w-40 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">From</label>
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => {
                        setFromDate(e.target.value)
                        setResolveError(null)
                      }}
                      className="w-40 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">To</label>
                    <input
                      type="date"
                      value={toDate}
                      onChange={(e) => {
                        setToDate(e.target.value)
                        setResolveError(null)
                      }}
                      className="w-40 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                </>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={resolvePeriod}
                  disabled={loadingResolve}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                >
                  {loadingResolve ? "Resolving…" : "Load reports"}
                </button>
                {resolveError && (
                  <button
                    type="button"
                    onClick={() => {
                      setResolveError(null)
                      resolvePeriod()
                    }}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Re-resolve period
                  </button>
                )}
              </div>
            </div>
            {resolveError && (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
                {resolveError}
              </p>
            )}
            {periodResolved && (
              <p className="mt-3 text-sm text-green-700 dark:text-green-400">
                Period: {periodResolved.period_start} → {periodResolved.period_end}
              </p>
            )}
          </div>

          {!periodResolved && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-6 text-center text-gray-600 dark:text-gray-400">
              Select a month or date range and click &quot;Load reports&quot; to resolve the period. Reports will appear after resolution.
            </div>
          )}

          {periodResolved && (
            <>
              <div className="border-b border-gray-200 dark:border-gray-700 mb-4">
                <nav className="flex gap-2">
                  {REPORT_TABS.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => handleTabChange(tab)}
                      className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px ${
                        activeTab === tab
                          ? "border-blue-600 text-blue-600 dark:text-blue-400"
                          : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </nav>
              </div>

              {reportError && (
                <div className="mb-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 flex items-center justify-between gap-4">
                  <p className="text-sm text-red-800 dark:text-red-200">{reportError}</p>
                  {reportError.includes("Period could not be resolved") && (
                    <button
                      type="button"
                      onClick={resolvePeriod}
                      className="px-3 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 rounded text-sm font-medium"
                    >
                      Re-resolve period
                    </button>
                  )}
                </div>
              )}

              {activeTab === "General Ledger" && (
                <div className="mb-4 flex flex-wrap items-end gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Account</label>
                    <select
                      value={selectedAccountId}
                      onChange={(e) => {
                        setSelectedAccountId(e.target.value)
                        setReportError(null)
                        setGlData(null)
                      }}
                      disabled={loadingCoa}
                      className="min-w-[200px] px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    >
                      <option value="">— Select account —</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={handleLoadGeneralLedger}
                    disabled={loadingReport || !selectedAccountId}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                  >
                    {loadingReport ? "Loading…" : "Load General Ledger"}
                  </button>
                </div>
              )}

              {(activeTab !== "General Ledger" || selectedAccountId) && loadingReport && (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-4">Loading report…</p>
              )}

              {activeTab === "Profit & Loss" && pnlData && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Profit & Loss</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {pnlData.period?.period_start} — {pnlData.period?.period_end}
                      </p>
                    </div>
                    {businessId && periodResolved && (
                      <div className="flex gap-2">
                        <a
                          href={`/api/accounting/reports/profit-and-loss/export/csv?business_id=${encodeURIComponent(businessId)}&period_start=${encodeURIComponent(periodResolved.period_start)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                        >
                          Export CSV
                        </a>
                        <a
                          href={`/api/accounting/reports/profit-and-loss/export/pdf?business_id=${encodeURIComponent(businessId)}&period_start=${encodeURIComponent(periodResolved.period_start)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                        >
                          Export PDF
                        </a>
                      </div>
                    )}
                  </div>
                  <div className="p-6">
                    <div className="mb-6">
                      <h4 className="text-md font-medium text-green-800 dark:text-green-300 mb-2">Revenue</h4>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-gray-700">
                            <th className="text-left py-2 text-gray-600 dark:text-gray-400">Code</th>
                            <th className="text-left py-2 text-gray-600 dark:text-gray-400">Name</th>
                            <th className="text-right py-2 text-gray-600 dark:text-gray-400">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(pnlData.revenue?.accounts || []).map((a) => (
                            <tr key={a.id} className="border-b border-gray-100 dark:border-gray-700/50">
                              <td className="py-2 font-mono">{a.code}</td>
                              <td className="py-2">{a.name}</td>
                              <td className="py-2 text-right">{formatCurrencySafe(a.period_total)}</td>
                            </tr>
                          ))}
                          <tr className="font-semibold text-green-800 dark:text-green-300">
                            <td colSpan={2} className="py-2">Total Revenue</td>
                            <td className="py-2 text-right">{formatCurrencySafe(pnlData.revenue?.total ?? 0)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="mb-6">
                      <h4 className="text-md font-medium text-red-800 dark:text-red-300 mb-2">Expenses</h4>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-gray-700">
                            <th className="text-left py-2 text-gray-600 dark:text-gray-400">Code</th>
                            <th className="text-left py-2 text-gray-600 dark:text-gray-400">Name</th>
                            <th className="text-right py-2 text-gray-600 dark:text-gray-400">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(pnlData.expenses?.accounts || []).map((a) => (
                            <tr key={a.id} className="border-b border-gray-100 dark:border-gray-700/50">
                              <td className="py-2 font-mono">{a.code}</td>
                              <td className="py-2">{a.name}</td>
                              <td className="py-2 text-right">{formatCurrencySafe(a.period_total)}</td>
                            </tr>
                          ))}
                          <tr className="font-semibold text-red-800 dark:text-red-300">
                            <td colSpan={2} className="py-2">Total Expenses</td>
                            <td className="py-2 text-right">{formatCurrencySafe(pnlData.expenses?.total ?? 0)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      Net Profit: {formatCurrencySafe(pnlData.netProfit ?? 0)} ({pnlData.profitMargin ?? 0}% margin)
                    </p>
                  </div>
                </div>
              )}

              {activeTab === "Balance Sheet" && bsData && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Balance Sheet</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">As of {bsData.as_of_date}</p>
                    </div>
                    {businessId && (
                      <div className="flex gap-2">
                        <a
                          href={`/api/accounting/reports/balance-sheet/export/csv?business_id=${encodeURIComponent(businessId)}&as_of_date=${encodeURIComponent(bsData.as_of_date)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                        >
                          Export CSV
                        </a>
                        <a
                          href={`/api/accounting/reports/balance-sheet/export/pdf?business_id=${encodeURIComponent(businessId)}&as_of_date=${encodeURIComponent(bsData.as_of_date)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                        >
                          Export PDF
                        </a>
                      </div>
                    )}
                  </div>
                  <div className="p-6 space-y-6">
                    <div>
                      <h4 className="text-md font-medium text-gray-800 dark:text-gray-200 mb-2">Assets</h4>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-gray-700">
                            <th className="text-left py-2 text-gray-600 dark:text-gray-400">Code</th>
                            <th className="text-left py-2 text-gray-600 dark:text-gray-400">Name</th>
                            <th className="text-right py-2 text-gray-600 dark:text-gray-400">Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(bsData.assets || []).map((a) => (
                            <tr key={a.id} className="border-b border-gray-100 dark:border-gray-700/50">
                              <td className="py-2 font-mono">{a.code}</td>
                              <td className="py-2">{a.name}</td>
                              <td className="py-2 text-right">{formatCurrencySafe(a.balance)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-right font-semibold py-2">Total Assets: {formatCurrencySafe(bsData.totals?.totalAssets ?? 0)}</p>
                    </div>
                    <div>
                      <h4 className="text-md font-medium text-gray-800 dark:text-gray-200 mb-2">Liabilities</h4>
                      <table className="w-full text-sm">
                        <tbody>
                          {(bsData.liabilities || []).map((a) => (
                            <tr key={a.id} className="border-b border-gray-100 dark:border-gray-700/50">
                              <td className="py-2 font-mono">{a.code}</td>
                              <td className="py-2">{a.name}</td>
                              <td className="py-2 text-right">{formatCurrencySafe(a.balance)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-right font-semibold py-2">Total Liabilities: {formatCurrencySafe(bsData.totals?.totalLiabilities ?? 0)}</p>
                    </div>
                    <div>
                      <h4 className="text-md font-medium text-gray-800 dark:text-gray-200 mb-2">Equity</h4>
                      <table className="w-full text-sm">
                        <tbody>
                          {(bsData.equity || []).map((a) => (
                            <tr key={a.id} className="border-b border-gray-100 dark:border-gray-700/50">
                              <td className="py-2 font-mono">{a.code}</td>
                              <td className="py-2">{a.name}</td>
                              <td className="py-2 text-right">{formatCurrencySafe(a.balance)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-right font-semibold py-2">Total Equity: {formatCurrencySafe(bsData.totals?.totalEquity ?? 0)}</p>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Balanced: {bsData.totals?.isBalanced ? "Yes" : "No"}
                    </p>
                  </div>
                </div>
              )}

              {activeTab === "Trial Balance" && tbData && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Trial Balance</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {tbData.period?.period_start} — {tbData.period?.period_end} · Balanced: {tbData.isBalanced ? "Yes" : "No"}
                      </p>
                    </div>
                    {businessId && periodResolved && (
                      <div className="flex gap-2">
                        <a
                          href={`/api/accounting/reports/trial-balance/export/csv?business_id=${encodeURIComponent(businessId)}&period_start=${encodeURIComponent(periodResolved.period_start)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                        >
                          Export CSV
                        </a>
                        <a
                          href={`/api/accounting/reports/trial-balance/export/pdf?business_id=${encodeURIComponent(businessId)}&period_start=${encodeURIComponent(periodResolved.period_start)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                        >
                          Export PDF
                        </a>
                      </div>
                    )}
                  </div>
                  <div className="p-6 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700">
                          <th className="text-left py-2 text-gray-600 dark:text-gray-400">Code</th>
                          <th className="text-left py-2 text-gray-600 dark:text-gray-400">Name</th>
                          <th className="text-left py-2 text-gray-600 dark:text-gray-400">Type</th>
                          <th className="text-right py-2 text-gray-600 dark:text-gray-400">Debits</th>
                          <th className="text-right py-2 text-gray-600 dark:text-gray-400">Credits</th>
                          <th className="text-right py-2 text-gray-600 dark:text-gray-400">Closing</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(tbData.accounts || []).map((acc) => (
                          <tr key={acc.account_id} className="border-b border-gray-100 dark:border-gray-700/50">
                            <td className="py-2 font-mono">{acc.account_code}</td>
                            <td className="py-2">{acc.account_name}</td>
                            <td className="py-2">{acc.account_type}</td>
                            <td className="py-2 text-right">{formatCurrencySafe(acc.debit_total ?? 0)}</td>
                            <td className="py-2 text-right">{formatCurrencySafe(acc.credit_total ?? 0)}</td>
                            <td className="py-2 text-right">{formatCurrencySafe(acc.closing_balance ?? 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                      Total Debits: {formatCurrencySafe(tbData.totals?.totalDebits ?? 0)} · Total Credits: {formatCurrencySafe(tbData.totals?.totalCredits ?? 0)}
                    </p>
                  </div>
                </div>
              )}

              {activeTab === "General Ledger" && glData && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">General Ledger</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {glData.account?.code} — {glData.account?.name} · {glData.period?.start_date} — {glData.period?.end_date}
                      </p>
                    </div>
                    {businessId && selectedAccountId && periodResolved && (
                      <div className="flex gap-2">
                        <a
                          href={`/api/accounting/reports/general-ledger/export/csv?business_id=${encodeURIComponent(businessId)}&account_id=${encodeURIComponent(selectedAccountId)}&period_start=${encodeURIComponent(periodResolved.period_start)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                        >
                          Export CSV
                        </a>
                        <a
                          href={`/api/accounting/reports/general-ledger/export/pdf?business_id=${encodeURIComponent(businessId)}&account_id=${encodeURIComponent(selectedAccountId)}&period_start=${encodeURIComponent(periodResolved.period_start)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                        >
                          Export PDF
                        </a>
                      </div>
                    )}
                  </div>
                  <div className="p-6 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700">
                          <th className="text-left py-2 text-gray-600 dark:text-gray-400">Date</th>
                          <th className="text-left py-2 text-gray-600 dark:text-gray-400">Description</th>
                          <th className="text-right py-2 text-gray-600 dark:text-gray-400">Debit</th>
                          <th className="text-right py-2 text-gray-600 dark:text-gray-400">Credit</th>
                          <th className="text-right py-2 text-gray-600 dark:text-gray-400">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(glData.lines || []).map((line, i) => (
                          <tr key={i} className="border-b border-gray-100 dark:border-gray-700/50">
                            <td className="py-2">{line.entry_date}</td>
                            <td className="py-2">{line.journal_entry_description ?? "—"}</td>
                            <td className="py-2 text-right">{formatCurrencySafe(line.debit)}</td>
                            <td className="py-2 text-right">{formatCurrencySafe(line.credit)}</td>
                            <td className="py-2 text-right">{formatCurrencySafe(line.running_balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {glData.totals && (
                      <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                        Total Debit: {formatCurrencySafe(glData.totals.total_debit)} · Total Credit: {formatCurrencySafe(glData.totals.total_credit)} · Final Balance: {formatCurrencySafe(glData.totals.final_balance)}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}
