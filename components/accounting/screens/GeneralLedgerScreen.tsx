"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { useAccountingBusiness } from "@/lib/accounting/useAccountingBusiness"
import { hasAccountingRouteContext } from "@/lib/accounting/assertAccountingRouteContext"
import { logAccountingRouteWithoutBusinessId } from "@/lib/accounting/devContextLogger"
import { useToast } from "@/components/ui/ToastProvider"
import { downloadFileFromApi } from "@/lib/download/downloadFileFromApi"
import { formatCurrencySafe } from "@/lib/currency/formatCurrency"
import { buildServiceRoute } from "@/lib/service/routes"
import { buildAccountingRoute } from "@/lib/accounting/routes"
import { PAYROLL_LIABILITY_PRESET_OPTIONS } from "@/lib/accounting/resolveGeneralLedgerAccountSelection"
import type { ScreenProps } from "./types"

type AccountingPeriod = {
  id: string
  business_id: string
  period_start: string
  period_end: string
  status: "open" | "soft_closed" | "locked"
}

type Account = {
  id: string
  code: string
  name: string
  type: string
}

type LedgerLine = {
  entry_date: string
  account_code?: string
  account_name?: string
  journal_entry_id: string
  journal_entry_description: string
  reference_type: string | null
  reference_id: string | null
  line_id: string
  line_description: string | null
  debit: number
  credit: number
  running_balance: number
}

type GlSummary = {
  opening_balance: number
  total_debit: number
  total_credit: number
  net_movement: number
  closing_balance: number
}

type MultiAccountSection = {
  account: Account
  summary: GlSummary
  totals: { total_debit: number; total_credit: number; final_balance: number }
  lines: LedgerLine[]
}

type GlViewMode = "single" | "range" | "preset"

type MultiMeta = {
  account_count: number
  max_accounts: number
  truncated: boolean
  empty_reason: string | null
  warning: string | null
}

export default function GeneralLedgerScreen({ mode, businessId: businessIdProp }: ScreenProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { businessId: urlBusinessId } = useAccountingBusiness()
  const businessId = mode === "service" ? businessIdProp : urlBusinessId ?? businessIdProp
  const routeContextOk = mode === "service" ? !!businessId : hasAccountingRouteContext(pathname ?? "", businessId)
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [noContext, setNoContext] = useState(false)
  const [businessIdState, setBusinessIdState] = useState<string | null>(businessId)
  const [periods, setPeriods] = useState<AccountingPeriod[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [viewMode, setViewMode] = useState<GlViewMode>("single")
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [accountCodeFrom, setAccountCodeFrom] = useState("")
  const [accountCodeTo, setAccountCodeTo] = useState("")
  const [selectedPeriodStart, setSelectedPeriodStart] = useState<string | null>(null)
  const [useDateRange, setUseDateRange] = useState(false)
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [lines, setLines] = useState<LedgerLine[]>([])
  const [account, setAccount] = useState<Account | null>(null)
  const [totals, setTotals] = useState<{ total_debit: number; total_credit: number; final_balance: number } | null>(null)
  const [summary, setSummary] = useState<GlSummary | null>(null)
  const [periodBounds, setPeriodBounds] = useState<{ start: string; end: string } | null>(null)
  const [error, setError] = useState("")
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<{
    entry_date: string
    journal_entry_id: string
    line_id: string
  } | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [urlHydrated, setUrlHydrated] = useState(false)
  const [multiSections, setMultiSections] = useState<MultiAccountSection[]>([])
  const [multiMeta, setMultiMeta] = useState<MultiMeta | null>(null)

  useEffect(() => {
    if (!routeContextOk && pathname && mode === "accounting") logAccountingRouteWithoutBusinessId(pathname)
  }, [routeContextOk, pathname, mode])

  useEffect(() => {
    if (mode === "service") {
      setBusinessIdState(businessIdProp)
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          if (!cancelled) {
            setError("Not authenticated")
            setLoading(false)
          }
          return
        }
        const ctx = await resolveAccountingContext({ supabase, userId: user.id, searchParams, source: "workspace" })
        if ("error" in ctx) {
          if (!cancelled) {
            setNoContext(true)
            setLoading(false)
          }
          return
        }
        if (!cancelled) {
          setBusinessIdState(ctx.businessId)
          setLoading(false)
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load business")
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mode, businessIdProp, searchParams])

  useEffect(() => {
    if (!businessIdState) return
    loadPeriods()
    loadAccounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessIdState])

  const applyUrlParams = useCallback(() => {
    if (!accounts.length) return
    if (searchParams.get("preset") === "payroll_liabilities") {
      setViewMode("preset")
    } else {
      const viewParam = searchParams.get("view") as GlViewMode | null
      if (viewParam === "range" || viewParam === "preset") {
        setViewMode(viewParam)
      } else {
        setViewMode("single")
      }
    }
    const from = searchParams.get("account_code_from")
    const to = searchParams.get("account_code_to")
    if (from) setAccountCodeFrom(from)
    if (to) setAccountCodeTo(to)

    const viewIsMulti =
      searchParams.get("preset") === "payroll_liabilities" ||
      searchParams.get("view") === "range" ||
      searchParams.get("view") === "preset"

    const aid = searchParams.get("account_id")
    const code = searchParams.get("account_code")
    if (!viewIsMulti) {
      if (aid) {
        const exists = accounts.some((a) => a.id === aid)
        if (exists) setSelectedAccountId(aid)
      } else if (code) {
        const found = accounts.find((a) => a.code === code.trim())
        if (found) setSelectedAccountId(found.id)
      }
    }
    const ps = searchParams.get("period_start")
    const sd = searchParams.get("start_date")
    const ed = searchParams.get("end_date")
    if (sd && ed) {
      setUseDateRange(true)
      setStartDate(sd)
      setEndDate(ed)
      setSelectedPeriodStart(null)
    } else if (ps) {
      setUseDateRange(false)
      setSelectedPeriodStart(ps.length === 7 ? `${ps}-01` : ps)
      setStartDate("")
      setEndDate("")
    }
    setUrlHydrated(true)
  }, [searchParams, accounts])

  useEffect(() => {
    if (!accounts.length) return
    const hasSingle = searchParams.get("account_id") || searchParams.get("account_code")
    const hasMulti =
      searchParams.get("view") === "range" ||
      searchParams.get("view") === "preset" ||
      searchParams.get("preset") === "payroll_liabilities" ||
      searchParams.get("account_code_from") ||
      searchParams.get("account_codes")
    if (!hasSingle && !hasMulti) {
      setUrlHydrated(true)
      return
    }
    applyUrlParams()
  }, [accounts, searchParams, applyUrlParams])

  const periodReady = !!(selectedPeriodStart || (useDateRange && startDate && endDate))

  useEffect(() => {
    if (!businessIdState || !urlHydrated || !periodReady) return
    if (viewMode === "single" && !selectedAccountId) return
    if (viewMode === "range" && (!accountCodeFrom.trim() || !accountCodeTo.trim())) return
    loadGeneralLedger(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    businessIdState,
    selectedAccountId,
    selectedPeriodStart,
    useDateRange,
    startDate,
    endDate,
    urlHydrated,
    viewMode,
    accountCodeFrom,
    accountCodeTo,
    periodReady,
  ])

  const loadPeriods = async () => {
    if (!businessIdState) return
    try {
      const response = await fetch(`/api/accounting/periods?business_id=${businessIdState}`)
      if (!response.ok) throw new Error("Failed to load periods")
      const data = await response.json()
      setPeriods(data.periods || [])
    } catch (err: unknown) {
      console.error("Error loading periods:", err)
    }
  }

  const loadAccounts = async () => {
    if (!businessIdState) return
    try {
      const response = await fetch(`/api/accounting/coa?business_id=${businessIdState}`)
      if (!response.ok) throw new Error("Failed to load accounts")
      const data = await response.json()
      setAccounts(data.accounts || [])
    } catch (err: unknown) {
      console.error("Error loading accounts:", err)
    }
  }

  const appendPeriodToUrl = (base: string) => {
    if (selectedPeriodStart && !useDateRange) {
      return `${base}&period_start=${encodeURIComponent(selectedPeriodStart)}`
    }
    if (useDateRange && startDate && endDate) {
      return `${base}&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`
    }
    return base
  }

  const loadGeneralLedger = async (reset: boolean = false) => {
    if (!businessIdState || !periodReady) return
    if (viewMode === "single" && !selectedAccountId) return
    if (viewMode === "range" && (!accountCodeFrom.trim() || !accountCodeTo.trim())) return

    try {
      if (reset) {
        setLoading(true)
        setLines([])
        setMultiSections([])
        setMultiMeta(null)
        setNextCursor(null)
        setHasMore(false)
      } else {
        setLoadingMore(true)
      }
      setError("")

      let url = `/api/accounting/reports/general-ledger?business_id=${encodeURIComponent(businessIdState)}&limit=100`
      url = appendPeriodToUrl(url)

      if (viewMode === "single") {
        url += `&account_id=${encodeURIComponent(selectedAccountId!)}`
        if (!reset && nextCursor) {
          url += `&cursor_entry_date=${encodeURIComponent(nextCursor.entry_date)}&cursor_journal_entry_id=${encodeURIComponent(nextCursor.journal_entry_id)}&cursor_line_id=${encodeURIComponent(nextCursor.line_id)}`
        }
      } else if (viewMode === "range") {
        url += `&account_code_from=${encodeURIComponent(accountCodeFrom.trim())}&account_code_to=${encodeURIComponent(accountCodeTo.trim())}`
      } else if (viewMode === "preset") {
        url += `&preset=payroll_liabilities`
      }

      const response = await fetch(url)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to load general ledger")
      }

      const data = await response.json()

      if (data.view === "multi") {
        setMultiSections(data.accounts || [])
        setMultiMeta(data.meta || null)
        setAccount(null)
        setLines([])
        setTotals(null)
        setSummary(null)
        setHasMore(false)
        setNextCursor(null)
        if (data.period?.start_date && data.period?.end_date) {
          setPeriodBounds({ start: data.period.start_date, end: data.period.end_date })
        }
      } else {
        setMultiSections([])
        setMultiMeta(null)
        setAccount(data.account)
        if (reset) {
          if (data.period?.start_date && data.period?.end_date) {
            setPeriodBounds({ start: data.period.start_date, end: data.period.end_date })
          }
          setLines(data.lines || [])
          setTotals(data.totals)
          if (data.summary !== undefined) setSummary(data.summary ?? null)
        } else {
          setLines((prevLines) => [...prevLines, ...(data.lines || [])])
        }

        if (data.pagination) {
          setHasMore(data.pagination.has_more || false)
          setNextCursor(data.pagination.next_cursor || null)
        } else {
          setHasMore(false)
          setNextCursor(null)
        }
      }

      setLoading(false)
      setLoadingMore(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load general ledger")
      setLoading(false)
      setLoadingMore(false)
    }
  }

  const handleLoadMore = () => {
    if (viewMode !== "single") return
    if (!loadingMore && hasMore && nextCursor) {
      loadGeneralLedger(false)
    }
  }

  const formatPeriod = (periodStart: string): string => {
    const date = new Date(periodStart)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    return `${year}-${month}`
  }

  const getReferenceLabel = (referenceType: string | null): string => {
    if (!referenceType) return "Manual Entry"
    const labels: Record<string, string> = {
      invoice: "Invoice",
      payment: "Payment",
      credit_note: "Credit Note",
      bill: "Bill",
      bill_payment: "Bill Payment",
      expense: "Expense",
      adjustment: "Adjustment",
      reversal: "Reversal",
      opening_balance: "Opening Balance",
      carry_forward: "Carry-Forward",
      manual: "Manual Entry",
    }
    return labels[referenceType] || referenceType
  }

  const buildGlPath = (query: string) => {
    const basePath = mode === "service" ? "/service/reports/general-ledger" : "/accounting/reports/general-ledger"
    const path = query ? `${basePath}?${query}` : basePath
    return mode === "service"
      ? buildServiceRoute(path, businessIdState ?? undefined)
      : buildAccountingRoute(path, businessIdState ?? undefined)
  }

  const openPreset = (code: string) => {
    const found = accounts.find((a) => a.code === code)
    if (!found) {
      toast.showToast(`Account ${code} is not in your chart of accounts`, "warning")
      return
    }
    setViewMode("single")
    setSelectedAccountId(found.id)
    const q = new URLSearchParams()
    q.set("account_code", found.code.trim())
    if (useDateRange && startDate && endDate) {
      q.set("start_date", startDate)
      q.set("end_date", endDate)
    } else if (selectedPeriodStart) {
      q.set("period_start", selectedPeriodStart)
    }
    router.push(buildGlPath(q.toString()))
  }

  const loadPayrollPresetMulti = () => {
    setViewMode("preset")
    setError("")
    const q = new URLSearchParams()
    q.set("view", "preset")
    if (useDateRange && startDate && endDate) {
      q.set("start_date", startDate)
      q.set("end_date", endDate)
    } else if (selectedPeriodStart) {
      q.set("period_start", selectedPeriodStart)
    }
    router.replace(buildGlPath(q.toString()))
  }

  const emptyReasonMessage = (reason: string | null): string => {
    if (!reason) return ""
    if (reason === "no_accounts_in_range") return "No accounts in this code range for your business."
    if (reason === "no_preset_accounts") return "None of the payroll liability accounts exist in your chart of accounts."
    if (reason === "no_matching_codes") return "No accounts matched the requested codes."
    return reason
  }

  const handleExportCSV = async () => {
    if (!businessIdState) {
      toast.showToast("Missing business", "warning")
      return
    }
    if (!periodReady) {
      toast.showToast("Please select a period or date range first", "warning")
      return
    }
    if (viewMode === "single" && !selectedAccountId) {
      toast.showToast("Please select an account first", "warning")
      return
    }
    if (viewMode === "range" && (!accountCodeFrom.trim() || !accountCodeTo.trim())) {
      toast.showToast("Enter from and to account codes", "warning")
      return
    }

    let url = `/api/accounting/reports/general-ledger/export/csv?business_id=${encodeURIComponent(businessIdState)}`
    url = appendPeriodToUrl(url)
    if (viewMode === "single") {
      url += `&account_id=${encodeURIComponent(selectedAccountId!)}`
    } else if (viewMode === "range") {
      url += `&account_code_from=${encodeURIComponent(accountCodeFrom.trim())}&account_code_to=${encodeURIComponent(accountCodeTo.trim())}`
    } else {
      url += `&preset=payroll_liabilities`
    }

    try {
      await downloadFileFromApi(url, { fallbackFilename: "general-ledger.csv" })
    } catch (err: unknown) {
      toast.showToast(err instanceof Error ? err.message : "Could not download CSV", "error")
    }
  }

  const handleExportPDF = async () => {
    if (viewMode !== "single") {
      toast.showToast("PDF export is available for single-account view only. Use CSV for multi-account.", "warning")
      return
    }
    if (!businessIdState || !selectedAccountId) {
      toast.showToast("Please select an account first", "warning")
      return
    }
    if (!periodReady) {
      toast.showToast("Please select a period or date range first", "warning")
      return
    }

    let url = `/api/accounting/reports/general-ledger/export/pdf?business_id=${encodeURIComponent(businessIdState)}&account_id=${encodeURIComponent(selectedAccountId)}`
    url = appendPeriodToUrl(url)

    try {
      await downloadFileFromApi(url, {
        fallbackFilename: "general-ledger.pdf",
        expectedMimePrefix: "application/pdf",
      })
    } catch (err: unknown) {
      toast.showToast(err instanceof Error ? err.message : "Could not download PDF", "error")
    }
  }

  const backUrl =
    mode === "service"
      ? buildServiceRoute("/service/accounting", businessIdState ?? undefined)
      : businessIdState
        ? `/accounting?business_id=${businessIdState}`
        : "/accounting"

  const showExportButtons =
    periodReady &&
    ((viewMode === "single" && !!selectedAccountId) ||
      (viewMode === "range" && !!accountCodeFrom.trim() && !!accountCodeTo.trim()) ||
      viewMode === "preset")

  if (loading && !account && multiSections.length === 0 && mode === "accounting") {
    return (
      <div className="p-6">
        <p>Loading...</p>
      </div>
    )
  }

  if (!routeContextOk || noContext || !businessIdState) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-6 text-amber-800 dark:text-amber-200">
            <p className="font-medium">Select a client or ensure you have an active business.</p>
            <p className="text-sm mt-1">No business context is available.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <button
              onClick={() => router.push(backUrl)}
              className="text-blue-600 dark:text-blue-400 hover:underline mb-2 text-sm"
            >
              ← Back to Accounting
            </button>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
              General Ledger
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-lg">
              General Ledger / Huvudbok — account activity by journal entry date (posting date). Use a custom date range for
              questions like “how much did I pay this year?”
            </p>
          </div>
          {showExportButtons && (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleExportCSV}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium flex items-center gap-2"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={handleExportPDF}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 font-medium flex items-center gap-2"
              >
                Export PDF
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}

        {multiMeta?.warning && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-400 text-amber-900 dark:text-amber-200 px-4 py-3 rounded mb-6">
            {multiMeta.warning}
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">View mode</p>
          <div className="flex flex-wrap gap-4 mb-4">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="gl-view"
                checked={viewMode === "single"}
                onChange={() => {
                  setViewMode("single")
                  setError("")
                }}
              />
              <span className="text-sm text-gray-800 dark:text-gray-200">Single account</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="gl-view"
                checked={viewMode === "range"}
                onChange={() => {
                  setViewMode("range")
                  setError("")
                }}
              />
              <span className="text-sm text-gray-800 dark:text-gray-200">Account code range</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="gl-view"
                checked={viewMode === "preset"}
                onChange={() => {
                  setViewMode("preset")
                  setError("")
                }}
              />
              <span className="text-sm text-gray-800 dark:text-gray-200">Payroll liabilities (preset)</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {viewMode === "single" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Account *</label>
                <select
                  value={selectedAccountId || ""}
                  onChange={(e) => {
                    setSelectedAccountId(e.target.value || null)
                    setError("")
                  }}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">-- Select Account --</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.code} - {acc.name} ({acc.type})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {viewMode === "range" && (
              <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    From account code *
                  </label>
                  <input
                    type="text"
                    value={accountCodeFrom}
                    onChange={(e) => {
                      setAccountCodeFrom(e.target.value)
                      setError("")
                    }}
                    placeholder="e.g. 2230"
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    To account code *
                  </label>
                  <input
                    type="text"
                    value={accountCodeTo}
                    onChange={(e) => {
                      setAccountCodeTo(e.target.value)
                      setError("")
                    }}
                    placeholder="e.g. 2233"
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                    Tip: you can also pass <span className="font-mono">account_codes=2230,2241</span> on the API for a fixed list of codes.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const q = new URLSearchParams()
                      q.set("view", "range")
                      q.set("account_code_from", accountCodeFrom.trim())
                      q.set("account_code_to", accountCodeTo.trim())
                      if (useDateRange && startDate && endDate) {
                        q.set("start_date", startDate)
                        q.set("end_date", endDate)
                      } else if (selectedPeriodStart) {
                        q.set("period_start", selectedPeriodStart)
                      }
                      router.replace(buildGlPath(q.toString()))
                    }}
                    className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    Update URL for this range (shareable)
                  </button>
                </div>
              </div>
            )}

            {viewMode === "preset" && (
              <div className="md:col-span-2">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                  Loads PAYE, SSNIT/Tier 1, Tier 2, net salaries payable, and employee deductions accounts that exist in
                  your chart (2230, 2231, 2232, 2240, 2241). Each account keeps its own running balance.
                </p>
                <button
                  type="button"
                  onClick={loadPayrollPresetMulti}
                  className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
                >
                  Sync URL for preset (shareable)
                </button>
              </div>
            )}

            <div className={viewMode === "single" ? "" : "md:col-span-1"}>
              <label className="flex items-center mb-2">
                <input
                  type="radio"
                  checked={!useDateRange}
                  onChange={() => setUseDateRange(false)}
                  className="mr-2"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Accounting period</span>
              </label>
              <select
                value={selectedPeriodStart || ""}
                onChange={(e) => {
                  setSelectedPeriodStart(e.target.value || null)
                  setError("")
                }}
                disabled={useDateRange}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
              >
                <option value="">-- Select Period --</option>
                {periods.map((period) => (
                  <option key={period.id} value={period.period_start}>
                    {formatPeriod(period.period_start)} ({period.status})
                  </option>
                ))}
              </select>
            </div>

            <div className={viewMode === "single" ? "" : "md:col-span-1"}>
              <label className="flex items-center mb-2">
                <input type="radio" checked={useDateRange} onChange={() => setUseDateRange(true)} className="mr-2" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Custom date range</span>
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Filters by journal_entries.date (inclusive).</p>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value)
                    setError("")
                  }}
                  disabled={!useDateRange}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value)
                    setError("")
                  }}
                  disabled={!useDateRange}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                />
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-600">
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Payroll liability shortcuts (single account)</p>
            <div className="flex flex-wrap gap-2">
              {PAYROLL_LIABILITY_PRESET_OPTIONS.map((p) => (
                <button
                  key={p.code}
                  type="button"
                  onClick={() => openPreset(p.code)}
                  className="px-3 py-1.5 text-xs font-medium rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {viewMode === "single" && account && summary && periodReady && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Account summary</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {account.code} — {account.name}
              {periodBounds ? (
                <span className="ml-2">
                  ({periodBounds.start} → {periodBounds.end})
                </span>
              ) : null}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/30">
                <p className="text-xs text-gray-500 dark:text-gray-400">Opening balance</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">{formatCurrencySafe(summary.opening_balance)}</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/30">
                <p className="text-xs text-gray-500 dark:text-gray-400">Total debits</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">{formatCurrencySafe(summary.total_debit)}</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/30">
                <p className="text-xs text-gray-500 dark:text-gray-400">Total credits</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">{formatCurrencySafe(summary.total_credit)}</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/30">
                <p className="text-xs text-gray-500 dark:text-gray-400">Net movement</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">{formatCurrencySafe(summary.net_movement)}</p>
              </div>
              <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
                <p className="text-xs text-gray-500 dark:text-gray-400">Closing balance</p>
                <p className="text-lg font-semibold text-emerald-900 dark:text-emerald-200">
                  {formatCurrencySafe(summary.closing_balance)}
                </p>
              </div>
            </div>
          </div>
        )}

        {(viewMode === "range" || viewMode === "preset") && periodReady && multiSections.length === 0 && !loading && multiMeta && (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 text-center mb-6">
            <p className="text-gray-600 dark:text-gray-400">{emptyReasonMessage(multiMeta.empty_reason)}</p>
          </div>
        )}

        {(viewMode === "range" || viewMode === "preset") &&
          multiSections.map((section) => (
            <div
              key={section.account.id}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6"
            >
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                {section.account.code} — {section.account.name}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                {section.account.type}
                {periodBounds ? (
                  <span className="ml-2">
                    ({periodBounds.start} → {periodBounds.end})
                  </span>
                ) : null}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/30">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Opening balance</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {formatCurrencySafe(section.summary.opening_balance)}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/30">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Total debits</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {formatCurrencySafe(section.summary.total_debit)}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/30">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Total credits</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {formatCurrencySafe(section.summary.total_credit)}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/30">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Net movement</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {formatCurrencySafe(section.summary.net_movement)}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Closing balance</p>
                  <p className="text-lg font-semibold text-emerald-900 dark:text-emerald-200">
                    {formatCurrencySafe(section.summary.closing_balance)}
                  </p>
                </div>
              </div>

              {section.lines.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Date</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Account</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Name</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Description</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Reference</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Debit</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Credit</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {section.lines.map((line) => (
                        <tr key={`${section.account.id}-${line.line_id}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                            {new Date(line.entry_date).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-sm font-mono text-gray-900 dark:text-white">{line.account_code ?? section.account.code}</td>
                          <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{line.account_name ?? section.account.name}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                            {line.line_description || line.journal_entry_description}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{getReferenceLabel(line.reference_type)}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                            {(line.debit ?? 0) > 0 ? formatCurrencySafe(line.debit) : "—"}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                            {(line.credit ?? 0) > 0 ? formatCurrencySafe(line.credit) : "—"}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-white">
                            {formatCurrencySafe(line.running_balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 dark:bg-gray-700 font-semibold">
                      <tr>
                        <td colSpan={5} className="px-4 py-3 text-right">
                          Period totals / final balance:
                        </td>
                        <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{formatCurrencySafe(section.totals.total_debit)}</td>
                        <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{formatCurrencySafe(section.totals.total_credit)}</td>
                        <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{formatCurrencySafe(section.totals.final_balance)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">No lines in this period for this account.</p>
              )}
            </div>
          ))}

        {viewMode === "single" && account && lines.length > 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Transactions: {account.code} - {account.name}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Date</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Account</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Name</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Description</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Reference</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Debit</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Credit</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {lines.map((line) => (
                    <tr key={line.line_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                        {new Date(line.entry_date).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-900 dark:text-white">{line.account_code ?? account.code}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{line.account_name ?? account.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                        {line.line_description || line.journal_entry_description}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{getReferenceLabel(line.reference_type)}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                        {(line.debit ?? 0) > 0 ? formatCurrencySafe(line.debit) : "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                        {(line.credit ?? 0) > 0 ? formatCurrencySafe(line.credit) : "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-white">
                        {formatCurrencySafe(line.running_balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {totals && (
                  <tfoot className="bg-gray-50 dark:bg-gray-700 font-semibold">
                    <tr>
                      <td colSpan={5} className="px-4 py-3 text-right">
                        Period totals / final balance:
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{formatCurrencySafe(totals.total_debit)}</td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{formatCurrencySafe(totals.total_credit)}</td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{formatCurrencySafe(totals.final_balance)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {hasMore && (
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                >
                  {loadingMore ? "Loading..." : "Load More"}
                </button>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                  Showing {lines.length} entries. {hasMore ? "Click to load more." : ""}
                </p>
              </div>
            )}

            {!hasMore && lines.length > 0 && (
              <div className="mt-4 text-center">
                <p className="text-sm text-gray-500 dark:text-gray-400">End of results. Showing {lines.length} total entries.</p>
              </div>
            )}
          </div>
        ) : viewMode === "single" && selectedAccountId && periodReady && !loading ? (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 text-center">
            <p className="text-gray-500 dark:text-gray-400">No journal entries in this range for the selected account.</p>
            {summary ? (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                Opening and closing balance are unchanged: {formatCurrencySafe(summary.closing_balance)}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
