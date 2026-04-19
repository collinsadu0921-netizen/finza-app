"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { retailPaths, retailReportApi } from "@/lib/retail/routes"
import { getCurrentBusiness } from "@/lib/business"
import { retailLedgerReportErrorMessage } from "@/lib/retail/reportClientErrors"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import {
  RetailBackofficeAlert,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeCardTitle,
  RetailBackofficeEmpty,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
  RetailBackofficeSkeleton,
  retailFieldClass,
  retailLabelClass,
  RetailMenuSelect,
  type MenuSelectOption,
} from "@/components/retail/RetailBackofficeUi"

const BS_NET_INCOME_WINDOW_OPTIONS: MenuSelectOption[] = [
  { value: "allTime", label: "All time (cumulative)" },
  { value: "thisMonth", label: "This month" },
  { value: "custom", label: "Custom" },
]

type AccountBalance = {
  id: string
  name: string
  code: string
  type: string
  debit: number
  credit: number
  balance: number
}

type BalanceSheetData = {
  asOfDate: string
  period?: {
    startDate: string
    endDate: string
  } | null
  assets: AccountBalance[]
  liabilities: AccountBalance[]
  equity: AccountBalance[]
  assetGroups?: {
    currentAssets: AccountBalance[]
    fixedAssets: AccountBalance[]
    accumulatedDepreciation: AccountBalance | null
    otherAssets: AccountBalance[]
  }
  totals: {
    totalCurrentAssets?: number
    grossFixedAssets?: number
    accumulatedDepreciation?: number
    netFixedAssets?: number
    totalOtherAssets?: number
    totalAssets: number
    totalLiabilities: number
    totalEquity: number
    currentPeriodNetIncome: number
    adjustedEquity: number
    totalLiabilitiesAndEquity: number
    balancingDifference: number
    isBalanced: boolean
  }
}

function getSafeRowKey(row: AccountBalance, index: number): string {
  if (row?.id && row.id.trim() !== "") return row.id
  return `${row?.code ?? "row"}-${index}`
}

export default function RetailBalanceSheetReportPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<BalanceSheetData | null>(null)
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split("T")[0])
  const [netIncomePeriod, setNetIncomePeriod] = useState<"allTime" | "thisMonth" | "custom">("allTime")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [error, setError] = useState("")
  const [business, setBusiness] = useState<any>(null)

  useEffect(() => {
    updateNetIncomePeriod()
  }, [netIncomePeriod])

  useEffect(() => {
    loadBalanceSheet()
  }, [asOfDate, startDate, endDate, netIncomePeriod])

  const updateNetIncomePeriod = () => {
    const now = new Date()
    
    if (netIncomePeriod === "thisMonth") {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
      setStartDate(firstDay.toISOString().split("T")[0])
      setEndDate(now.toISOString().split("T")[0])
    } else if (netIncomePeriod === "allTime") {
      setStartDate("")
      setEndDate("")
    }
    // For custom, keep existing dates or let user set them
  }

  const loadBalanceSheet = async () => {
    try {
      setLoading(true)
      setError("")

      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setError("Sign in to view this report.")
        setLoading(false)
        return
      }

      const currentBusiness = await getCurrentBusiness(supabase, user.id)
      if (!currentBusiness) {
        setError("No store was found for your account.")
        setBusiness(null)
        setLoading(false)
        return
      }
      setBusiness(currentBusiness)

      const params = new URLSearchParams()
      if (asOfDate) params.set("as_of_date", asOfDate)

      const response = await fetch(`${retailReportApi.balanceSheet}?${params.toString()}`)

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as Record<string, unknown>
        setError(retailLedgerReportErrorMessage(response.status, errorData))
        setData(null)
        setLoading(false)
        return
      }

      const raw = await response.json()
      const flattenLines = (groups: { key: string; label: string; lines: { account_code: string; account_name: string; amount: number }[]; subtotal: number }[]) =>
        groups.flatMap((g) => g.lines.map((l) => ({ id: "", code: l.account_code, name: l.account_name, type: "", debit: 0, credit: 0, balance: l.amount })))
      const assetsSection = raw.sections?.find((s: { key: string }) => s.key === "assets")
      const liabSection = raw.sections?.find((s: { key: string }) => s.key === "liabilities")
      const equitySection = raw.sections?.find((s: { key: string }) => s.key === "equity")
      const balanceSheetData: BalanceSheetData = {
        asOfDate: raw.as_of_date ?? raw.period?.period_end ?? asOfDate,
        period: raw.period ? { startDate: raw.period.period_start, endDate: raw.period.period_end } : null,
        assets: assetsSection ? flattenLines(assetsSection.groups ?? []) : [],
        liabilities: liabSection ? flattenLines(liabSection.groups ?? []) : [],
        equity: equitySection ? flattenLines(equitySection.groups ?? []) : [],
        assetGroups: assetsSection?.groups ? {
          currentAssets: (assetsSection.groups.find((g: { key: string }) => g.key === "current_assets")?.lines ?? []).map((l: { account_code: string; account_name: string; amount: number }) => ({ id: "", code: l.account_code, name: l.account_name, type: "asset", debit: 0, credit: 0, balance: l.amount })),
          fixedAssets: (assetsSection.groups.find((g: { key: string }) => g.key === "fixed_assets")?.lines ?? []).map((l: { account_code: string; account_name: string; amount: number }) => ({ id: "", code: l.account_code, name: l.account_name, type: "asset", debit: 0, credit: 0, balance: l.amount })),
          accumulatedDepreciation: null,
          otherAssets: (assetsSection.groups.find((g: { key: string }) => g.key === "other_assets")?.lines ?? []).map((l: { account_code: string; account_name: string; amount: number }) => ({ id: "", code: l.account_code, name: l.account_name, type: "asset", debit: 0, credit: 0, balance: l.amount })),
        } : undefined,
        totals: {
          totalAssets: raw.totals?.assets ?? 0,
          totalLiabilities: raw.totals?.liabilities ?? 0,
          totalEquity: raw.totals?.equity ?? 0,
          currentPeriodNetIncome: 0,
          adjustedEquity: raw.totals?.liabilities_plus_equity ? (raw.totals.liabilities_plus_equity - (raw.totals?.liabilities ?? 0)) : 0,
          totalLiabilitiesAndEquity: raw.totals?.liabilities_plus_equity ?? 0,
          balancingDifference: raw.totals?.imbalance ?? 0,
          isBalanced: raw.totals?.is_balanced ?? true,
        },
      }
      setData(balanceSheetData)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load balance sheet")
      setLoading(false)
    }
  }

  const { format } = useBusinessCurrency()
  const formatCurrency = (amount: number) => format(Math.abs(amount))

  if (loading) {
    return (
      <RetailBackofficeShell>
        <RetailBackofficeMain className="max-w-7xl">
          <RetailBackofficePageHeader
            eyebrow="Reports"
            title="Balance sheet"
            description="Loading assets, liabilities, and equity as of your chosen date."
          />
          <RetailBackofficeSkeleton rows={10} />
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  if (error) {
    return (
      <RetailBackofficeShell>
        <RetailBackofficeMain className="max-w-7xl">
          <RetailBackofficePageHeader eyebrow="Reports" title="Balance sheet" description="We could not load this report." />
          <RetailBackofficeAlert tone="error">{error}</RetailBackofficeAlert>
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  if (!data) {
    return (
      <RetailBackofficeShell>
        <RetailBackofficeMain className="max-w-7xl">
          <RetailBackofficeEmpty title="No balance sheet data" description="Try again or pick a different as-of date." />
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain className="max-w-7xl">
        <RetailBackofficeAlert tone="info" className="mb-6">
          Read-only snapshot from your books. Balances reflect activity through the as-of date. Export is not available on
          this retail view.
        </RetailBackofficeAlert>

        {!business?.default_currency ? (
          <RetailBackofficeAlert tone="warning" className="mb-4">
            <p className="font-medium">Set your store currency</p>
            <p className="mt-1 text-sm opacity-90">Use Business profile so amounts format correctly.</p>
            <RetailBackofficeButton variant="secondary" className="mt-3" onClick={() => router.push(retailPaths.settingsBusinessProfile)}>
              Open business profile
            </RetailBackofficeButton>
          </RetailBackofficeAlert>
        ) : null}

        <RetailBackofficePageHeader
          eyebrow="Reports"
          title="Balance sheet"
          description={`What the store owns and owes as of ${new Date(data.asOfDate).toLocaleDateString("en-GH", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}.`}
          actions={
            business?.default_currency ? (
              <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
                {business.default_currency}
              </span>
            ) : null
          }
        />

        <RetailBackofficeCard className="mb-8">
          <RetailBackofficeCardTitle className="mb-4">Dates &amp; net income window</RetailBackofficeCardTitle>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <label htmlFor="asOfDate" className={retailLabelClass}>
                As of date
              </label>
              <input type="date" id="asOfDate" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className={retailFieldClass} />
              <p className="mt-1.5 text-xs text-slate-500">Balances are cut off at the end of this day.</p>
            </div>
            <div>
              <label className={retailLabelClass}>Net income window (aligns with P&amp;L)</label>
              <RetailMenuSelect
                value={netIncomePeriod}
                onValueChange={(v) => setNetIncomePeriod(v as "allTime" | "thisMonth" | "custom")}
                options={BS_NET_INCOME_WINDOW_OPTIONS}
              />
              {netIncomePeriod === "custom" && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className={retailLabelClass}>Start</label>
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={retailFieldClass} />
                  </div>
                  <div>
                    <label className={retailLabelClass}>End</label>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={retailFieldClass} />
                  </div>
                </div>
              )}
              {data?.period ? (
                <p className="mt-2 text-xs text-slate-500">
                  Net income window: {new Date(data.period.startDate).toLocaleDateString()} –{" "}
                  {new Date(data.period.endDate).toLocaleDateString()}
                </p>
              ) : null}
            </div>
          </div>
        </RetailBackofficeCard>

        <RetailBackofficeCard padding="p-0" className="overflow-hidden">
            <div className="p-6">
              {/* Assets Section */}
              <div className="mb-8">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">ASSETS</h2>
                {data.assets.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic">No asset accounts</p>
                ) : (
                  <div className="space-y-4">
                    {/* Current Assets */}
                    {data.assetGroups?.currentAssets && data.assetGroups.currentAssets.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase">Current Assets</h3>
                        <div className="space-y-2 ml-4">
                          {data.assetGroups.currentAssets.map((account, index) => (
                            <div
                              key={getSafeRowKey(account, index)}
                              className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700 last:border-0"
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-mono text-gray-500 dark:text-gray-400 w-16">
                                  {account.code}
                                </span>
                                <span className="text-sm text-gray-900 dark:text-white">{account.name}</span>
                              </div>
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                {formatCurrency(account.balance)}
                              </span>
                            </div>
                          ))}
                          {data.totals.totalCurrentAssets !== undefined && (
                            <div className="flex justify-between items-center py-2 mt-2 border-t border-gray-300 dark:border-gray-600">
                              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Total Current Assets</span>
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                {formatCurrency(data.totals.totalCurrentAssets)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Fixed Assets */}
                    {data.assetGroups?.fixedAssets && data.assetGroups.fixedAssets.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase">Fixed Assets</h3>
                        <div className="space-y-2 ml-4">
                          {data.assetGroups.fixedAssets.map((account, index) => (
                            <div
                              key={getSafeRowKey(account, index)}
                              className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700 last:border-0"
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-mono text-gray-500 dark:text-gray-400 w-16">
                                  {account.code}
                                </span>
                                <span className="text-sm text-gray-900 dark:text-white">{account.name}</span>
                              </div>
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                {formatCurrency(account.balance)}
                              </span>
                            </div>
                          ))}
                          {data.totals.grossFixedAssets !== undefined && (
                            <div className="flex justify-between items-center py-2 mt-2 border-t border-gray-300 dark:border-gray-600">
                              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Gross Fixed Assets</span>
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                {formatCurrency(data.totals.grossFixedAssets)}
                              </span>
                            </div>
                          )}
                          {data.assetGroups.accumulatedDepreciation && data.totals.accumulatedDepreciation !== undefined && data.totals.accumulatedDepreciation > 0 && (
                            <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-mono text-gray-500 dark:text-gray-400 w-16">
                                  {data.assetGroups.accumulatedDepreciation.code}
                                </span>
                                <span className="text-sm text-gray-900 dark:text-white">
                                  Less: {data.assetGroups.accumulatedDepreciation.name}
                                </span>
                              </div>
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                ({formatCurrency(data.totals.accumulatedDepreciation)})
                              </span>
                            </div>
                          )}
                          {data.totals.netFixedAssets !== undefined && (
                            <div className="flex justify-between items-center py-2 border-t border-gray-300 dark:border-gray-600">
                              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Net Fixed Assets</span>
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                {formatCurrency(data.totals.netFixedAssets)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Other Assets */}
                    {data.assetGroups?.otherAssets && data.assetGroups.otherAssets.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase">Other Assets</h3>
                        <div className="space-y-2 ml-4">
                          {data.assetGroups.otherAssets.map((account, index) => (
                            <div
                              key={getSafeRowKey(account, index)}
                              className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700 last:border-0"
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-mono text-gray-500 dark:text-gray-400 w-16">
                                  {account.code}
                                </span>
                                <span className="text-sm text-gray-900 dark:text-white">{account.name}</span>
                              </div>
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                {formatCurrency(account.balance)}
                              </span>
                            </div>
                          ))}
                          {data.totals.totalOtherAssets !== undefined && (
                            <div className="flex justify-between items-center py-2 mt-2 border-t border-gray-300 dark:border-gray-600">
                              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Total Other Assets</span>
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                {formatCurrency(data.totals.totalOtherAssets)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Fallback: If assetGroups not available, show all assets */}
                    {!data.assetGroups && (
                      <div className="space-y-2">
                        {data.assets.map((account, index) => (
                          <div
                            key={getSafeRowKey(account, index)}
                            className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700 last:border-0"
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-mono text-gray-500 dark:text-gray-400 w-16">
                                {account.code}
                              </span>
                              <span className="text-sm text-gray-900 dark:text-white">{account.name}</span>
                            </div>
                            <span className="text-sm font-semibold text-gray-900 dark:text-white">
                              {formatCurrency(account.balance)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Total Assets */}
                    <div className="flex justify-between items-center py-3 mt-4 border-t-2 border-gray-900 dark:border-gray-100">
                      <span className="text-base font-bold text-gray-900 dark:text-white">Total Assets</span>
                      <span className="text-base font-bold text-gray-900 dark:text-white">
                        {formatCurrency(data.totals.totalAssets)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Liabilities Section */}
              <div className="mb-8">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">LIABILITIES</h2>
                {data.liabilities.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic">No liability accounts</p>
                ) : (
                  <div className="space-y-2">
                    {data.liabilities.map((account, index) => (
                      <div
                        key={getSafeRowKey(account, index)}
                        className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700 last:border-0"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-mono text-gray-500 dark:text-gray-400 w-16">
                            {account.code}
                          </span>
                          <span className="text-sm text-gray-900 dark:text-white">{account.name}</span>
                        </div>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          {formatCurrency(account.balance)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between items-center py-3 mt-4 border-t-2 border-gray-900 dark:border-gray-100">
                      <span className="text-base font-bold text-gray-900 dark:text-white">Total Liabilities</span>
                      <span className="text-base font-bold text-gray-900 dark:text-white">
                        {formatCurrency(data.totals.totalLiabilities)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Equity Section */}
              <div className="mb-8">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">EQUITY</h2>
                {data.equity.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic">No equity accounts</p>
                ) : (
                  <div className="space-y-2">
                    {data.equity.map((account, index) => (
                      <div
                        key={getSafeRowKey(account, index)}
                        className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700 last:border-0"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-mono text-gray-500 dark:text-gray-400 w-16">
                            {account.code}
                          </span>
                          <span className="text-sm text-gray-900 dark:text-white">{account.name}</span>
                        </div>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          {formatCurrency(account.balance)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between items-center py-3 mt-4 border-t-2 border-gray-900 dark:border-gray-100">
                      <span className="text-base font-bold text-gray-900 dark:text-white">Total Equity (before closing)</span>
                      <span className="text-base font-bold text-gray-900 dark:text-white">
                        {formatCurrency(data.totals.totalEquity)}
                      </span>
                    </div>
                    {Math.abs(data.totals.currentPeriodNetIncome) >= 0.01 && (
                      <>
                        <div className="flex justify-between items-center py-2 mt-2 border-t border-gray-200 dark:border-gray-700">
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            Current Period Net {data.totals.currentPeriodNetIncome >= 0 ? "Income" : "Loss"}
                          </span>
                          <span className={`text-sm font-medium ${data.totals.currentPeriodNetIncome >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                            {formatCurrency(data.totals.currentPeriodNetIncome)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-t border-gray-900 dark:border-gray-100">
                          <span className="text-base font-bold text-gray-900 dark:text-white">Adjusted Equity (after closing)</span>
                          <span className="text-base font-bold text-gray-900 dark:text-white">
                            {formatCurrency(data.totals.adjustedEquity)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Total Liabilities + Equity */}
              <div className="flex justify-between items-center py-4 mt-6 border-t-2 border-gray-900 dark:border-gray-100">
                <span className="text-lg font-bold text-gray-900 dark:text-white">Total Liabilities + Equity</span>
                <span className="text-lg font-bold text-gray-900 dark:text-white">
                  {formatCurrency(data.totals.totalLiabilitiesAndEquity)}
                </span>
              </div>

              {/* Balance Verification */}
              {Math.abs(data.totals.balancingDifference) >= 0.01 && (
                <div className={`mt-4 p-4 rounded-lg border ${
                  data.totals.isBalanced 
                    ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                    : "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800"
                }`}>
                  {data.totals.isBalanced ? (
                    <p className="text-sm text-green-800 dark:text-green-200">
                      <strong>✓ Balanced:</strong> Assets match liabilities plus equity for this view (including current period net
                      income in equity where applicable).
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm text-yellow-800 dark:text-yellow-200">
                        <strong>Note:</strong> Remaining balance sheet difference: {formatCurrency(data.totals.balancingDifference)}.
                        This may indicate:
                      </p>
                      <ul className="text-sm text-yellow-700 dark:text-yellow-300 list-disc list-inside ml-2">
                        <li>Unbalanced journal entries (debits don’t equal credits)</li>
                        <li>Missing entries for some activity</li>
                        <li>Inconsistencies in your books</li>
                      </ul>
                      <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                        Ask a store admin to review your ledger if this persists.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
        </RetailBackofficeCard>
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}

