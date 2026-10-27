"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import TierGate from "@/components/service/TierGate"
import LoadingScreen from "@/components/ui/LoadingScreen"
import PageHeader from "@/components/ui/PageHeader"
import EmptyState from "@/components/ui/EmptyState"
import { StatusBadge } from "@/components/ui/StatusBadge"
import { formatDate } from "@/lib/exportUtils"
import type { MonthlyVatReturn } from "@/app/api/vat-returns/monthly/route"
import { vatCreateHref, vatFilingHref } from "@/lib/vat/vatRoutes"
import { formatMoney } from "@/lib/money"
import { repairMojibake } from "@/lib/text/repairMojibake"
import { ledgerReferenceLabel, ledgerSourceLabel } from "@/lib/vat/ledgerDisplay"

type FiledReturn = {
  id: string
  period_start_date: string
  period_end_date: string
  status: string
  payment_state?: "unpaid" | "paid_recorded" | "paid_without_payment"
}

function formatCedi(value: number | null | undefined): string {
  return formatMoney(Number(value ?? 0), "GHS")
}

export default function VatReturnsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const businessId = searchParams.get("business_id") ?? searchParams.get("businessId") ?? null
  const [loading, setLoading] = useState(true)
  const [monthlyReturns, setMonthlyReturns] = useState<MonthlyVatReturn[]>([])
  const [grandTotalNetVat, setGrandTotalNetVat] = useState(0)
  const [filedByMonth, setFiledByMonth] = useState<Record<string, FiledReturn>>({})
  const [selectedMonth, setSelectedMonth] = useState<MonthlyVatReturn | null>(null)
  const [showDetailsModal, setShowDetailsModal] = useState(false)

  useEffect(() => {
    loadData()
  }, [businessId])

  const loadData = async () => {
    try {
      setLoading(true)

      // Fetch monthly ledger data and filed returns in parallel
      const [monthlyRes, listRes] = await Promise.all([
        fetch(businessId ? `/api/vat-returns/monthly?business_id=${encodeURIComponent(businessId)}` : "/api/vat-returns/monthly"),
        fetch(businessId ? `/api/vat-returns/list?business_id=${encodeURIComponent(businessId)}` : "/api/vat-returns/list"),
      ])

      if (monthlyRes.ok) {
        const data = await monthlyRes.json()
        setMonthlyReturns(data.monthlyReturns || [])
        setGrandTotalNetVat(data.grandTotalNetVat || 0)
      } else {
        setMonthlyReturns([])
      }

      if (listRes.ok) {
        const listData = await listRes.json()
        // Index filed returns by their start month (YYYY-MM)
        const byMonth: Record<string, FiledReturn> = {}
        for (const r of (listData.returns || [])) {
          const key = (r.period_start_date as string).substring(0, 7)
          byMonth[key] = r
        }
        setFiledByMonth(byMonth)
      }
    } catch (error) {
      console.error("Error loading VAT returns:", error)
      setMonthlyReturns([])
    } finally {
      setLoading(false)
    }
  }

  const formatMonth = (monthKey: string) => {
    const [year, month] = monthKey.split("-")
    const date = new Date(parseInt(year), parseInt(month) - 1, 1)
    return date.toLocaleDateString("en-GH", { month: "long", year: "numeric" })
  }

  const handleMonthClick = (monthReturn: MonthlyVatReturn) => {
    setSelectedMonth(monthReturn)
    setShowDetailsModal(true)
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <LoadingScreen />
      </ProtectedLayout>
    )
  }

  return (
    <TierGate minTier="professional">
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
            <PageHeader
              title="VAT Filings"
              subtitle="Monthly VAT from the immutable ledger (accounts 2100–2130)"
            />
            <button
              onClick={() => router.push(vatCreateHref({ businessId }))}
              className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-black transition-colors shadow-sm shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New filing
            </button>
          </div>

          {monthlyReturns.length === 0 ? (
            <EmptyState
              icon={
                <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              }
              title="No VAT ledger entries found"
              description="No postings to tax control accounts (2100–2130) found yet."
            />
          ) : (
            <>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-6">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Month</th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Output Tax</th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Input Tax</th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Net VAT</th>
                        <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {monthlyReturns.map((monthReturn) => {
                        const outputTotal = monthReturn.output_nhil + monthReturn.output_getfund + monthReturn.output_vat
                        const inputTotal = monthReturn.input_nhil + monthReturn.input_getfund + monthReturn.input_vat
                        const filed = filedByMonth[monthReturn.month]
                        return (
                          <tr key={monthReturn.month} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {formatMonth(monthReturn.month)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-gray-700">
                              {formatCedi(outputTotal)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-gray-700">
                              {formatCedi(inputTotal)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                              <span className={`font-bold ${monthReturn.net_vat >= 0 ? "text-red-600" : "text-green-600"}`}>
                                {formatCedi(monthReturn.net_vat)}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              {filed ? (
                                <div className="flex flex-col items-center gap-1">
                                  <StatusBadge status={repairMojibake(filed.status)} />
                                  {filed.payment_state === "paid_without_payment" && (
                                    <span
                                      className="inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                                      title="Paid status was recorded without a linked payment journal. The tax liabilities remain in the ledger."
                                    >
                                      Paid · no journal
                                    </span>
                                  )}
                                  {filed.payment_state === "paid_recorded" && (
                                    <span
                                      className="inline-flex items-center rounded bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800 dark:bg-green-900/40 dark:text-green-200"
                                      title="Payment journal posted and linked."
                                    >
                                      Payment recorded
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
                                  Not filed
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                              <div className="flex items-center justify-center gap-3">
                                <button
                                  onClick={() => handleMonthClick(monthReturn)}
                                  className="text-blue-600 hover:text-blue-800 font-medium transition-colors"
                                >
                                  Ledger
                                </button>
                                {filed ? (
                                  <button
                                    onClick={() => router.push(vatFilingHref(filed.id, businessId))}
                                    className="text-slate-600 hover:text-slate-900 font-medium transition-colors"
                                  >
                                    View filing
                                  </button>
                                ) : (
                                  <button
                                    onClick={() =>
                                      router.push(
                                        vatCreateHref({
                                          start: `${monthReturn.month}-01`,
                                          end: `${monthReturn.month}-${new Date(parseInt(monthReturn.month.split("-")[0]), parseInt(monthReturn.month.split("-")[1]), 0).getDate()}`,
                                          businessId,
                                        })
                                      )
                                    }
                                    className="text-green-600 hover:text-green-800 font-medium transition-colors"
                                  >
                                    Start filing
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Grand Total */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">Total VAT Liability</h3>
                    <p className="text-xs text-gray-500 mt-1">
                      Sum of all months' net VAT (Output credits − Input debits on account 2100)
                    </p>
                  </div>
                  <span className={`text-2xl font-bold ${grandTotalNetVat >= 0 ? "text-red-600" : "text-green-600"}`}>
                    {formatCedi(grandTotalNetVat)}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Details Modal */}
        {showDetailsModal && selectedMonth && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-start">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">
                    VAT Ledger — {formatMonth(selectedMonth.month)}
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">journal_entry_lines on accounts 2100–2130</p>
                </div>
                <div className="flex items-center gap-3">
                  {!filedByMonth[selectedMonth.month] && (
                    <button
                      onClick={() => {
                        const [year, month] = selectedMonth.month.split("-")
                        const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate()
                        router.push(
                          vatCreateHref({
                            start: `${selectedMonth.month}-01`,
                            end: `${selectedMonth.month}-${lastDay}`,
                            businessId,
                          })
                        )
                        setShowDetailsModal(false)
                      }}
                      className="px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-black transition-colors"
                    >
                      File VAT for this month
                    </button>
                  )}
                  {filedByMonth[selectedMonth.month] && (
                    <button
                      onClick={() => {
                        router.push(
                          vatFilingHref(
                            filedByMonth[selectedMonth.month].id,
                            businessId
                          )
                        )
                        setShowDetailsModal(false)
                      }}
                      className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      View filed VAT
                    </button>
                  )}
                  <button
                    onClick={() => setShowDetailsModal(false)}
                    className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* Summary grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Output Tax (Credits)</h3>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">NHIL <span className="text-xs">(levy)</span></span>
                        <span>{formatCedi(selectedMonth.output_nhil)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">GETFund <span className="text-xs">(levy)</span></span>
                        <span>{formatCedi(selectedMonth.output_getfund)}</span>
                      </div>
                      <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                        <span>VAT (15%)</span>
                        <span>{formatCedi(selectedMonth.output_vat)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Input Tax (Debits)</h3>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">NHIL <span className="text-xs">(levy)</span></span>
                        <span>{formatCedi(selectedMonth.input_nhil)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">GETFund <span className="text-xs">(levy)</span></span>
                        <span>{formatCedi(selectedMonth.input_getfund)}</span>
                      </div>
                      <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                        <span>VAT (15%)</span>
                        <span>{formatCedi(selectedMonth.input_vat)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Net VAT */}
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 flex justify-between items-center">
                  <p className="text-base font-semibold text-gray-900">Net VAT Payable</p>
                  <span className={`text-2xl font-bold ${selectedMonth.net_vat >= 0 ? "text-red-600" : "text-green-600"}`}>
                    {formatCedi(selectedMonth.net_vat)}
                  </span>
                </div>

                {/* Ledger entries */}
                <div>
                  <h3 className="text-base font-semibold text-gray-900 mb-3">
                    Ledger Entries ({selectedMonth.entries.length})
                  </h3>
                  {selectedMonth.entries.length === 0 ? (
                    <p className="text-sm text-gray-500">No ledger entries for this month</p>
                  ) : (
                    <>
                    <div className="hidden overflow-x-auto md:block">
                      <table className="w-full min-w-[860px] text-sm">
                        <caption className="sr-only">
                          VAT ledger entries with invoice and bill references
                        </caption>
                        <thead className="bg-gray-50">
                          <tr>
                            <th scope="col" className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Date</th>
                            <th scope="col" className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Type</th>
                            <th scope="col" className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Reference</th>
                            <th scope="col" className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Description</th>
                            <th scope="col" className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Tax</th>
                            <th scope="col" className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Credit (Output)</th>
                            <th scope="col" className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Debit (Input)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {selectedMonth.entries.map((entry) => {
                            const reference = ledgerReferenceLabel(entry)
                            return (
                              <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-2 text-gray-600 whitespace-nowrap tabular-nums">
                                  {formatDate(entry.date)}
                                </td>
                                <td className="px-4 py-2 text-gray-500 whitespace-nowrap text-xs">
                                  {ledgerSourceLabel(entry)}
                                </td>
                                <td className="px-4 py-2 text-gray-700 whitespace-nowrap text-xs font-medium">
                                  <span
                                    className={reference.startsWith("#") ? "font-mono" : ""}
                                    title={entry.reference_id ?? reference}
                                  >
                                    {reference}
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-gray-700 min-w-[16rem] max-w-md whitespace-normal break-words">
                                  {repairMojibake(entry.description || "—")}
                                </td>
                                <td className="px-4 py-2">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                                    {entry.tax_code}
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-right text-blue-700 font-medium whitespace-nowrap tabular-nums">
                                  {entry.credit > 0 ? formatCedi(entry.credit) : "—"}
                                </td>
                                <td className="px-4 py-2 text-right text-green-700 font-medium whitespace-nowrap tabular-nums">
                                  {entry.debit > 0 ? formatCedi(entry.debit) : "—"}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                          <tr>
                            <th scope="row" colSpan={5} className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">
                              Month totals
                            </th>
                            <td className="px-4 py-2 text-right font-bold text-blue-700 whitespace-nowrap tabular-nums">
                              {formatCedi(
                                selectedMonth.entries.reduce(
                                  (sum, entry) => sum + Number(entry.credit || 0),
                                  0
                                )
                              )}
                            </td>
                            <td className="px-4 py-2 text-right font-bold text-green-700 whitespace-nowrap tabular-nums">
                              {formatCedi(
                                selectedMonth.entries.reduce(
                                  (sum, entry) => sum + Number(entry.debit || 0),
                                  0
                                )
                              )}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <div className="space-y-2 md:hidden">
                      {selectedMonth.entries.map((entry) => (
                        <div
                          key={entry.id}
                          className="rounded-lg border border-gray-200 bg-white p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs text-gray-500">
                                {formatDate(entry.date)} · {ledgerSourceLabel(entry)}
                              </p>
                              <p className="mt-0.5 text-sm font-medium text-gray-900 break-words">
                                {repairMojibake(entry.description || "—")}
                              </p>
                              <p className="mt-0.5 text-xs text-gray-500 break-words">
                                {ledgerReferenceLabel(entry)}
                              </p>
                            </div>
                            <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                              {entry.tax_code}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
                            <span className="text-blue-700">
                              Output: {entry.credit > 0 ? formatCedi(entry.credit) : "—"}
                            </span>
                            <span className="text-green-700">
                              Input: {entry.debit > 0 ? formatCedi(entry.debit) : "—"}
                            </span>
                          </div>
                        </div>
                      ))}
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm font-semibold">
                        <span className="text-xs uppercase tracking-wider text-gray-600">
                          Month totals
                        </span>
                        <span className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                          <span className="text-blue-700">
                            Output:{" "}
                            {formatCedi(
                              selectedMonth.entries.reduce(
                                (sum, entry) => sum + Number(entry.credit || 0),
                                0
                              )
                            )}
                          </span>
                          <span className="text-green-700">
                            Input:{" "}
                            {formatCedi(
                              selectedMonth.entries.reduce(
                                (sum, entry) => sum + Number(entry.debit || 0),
                                0
                              )
                            )}
                          </span>
                        </span>
                      </div>
                    </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ProtectedLayout>
    </TierGate>
  )
}
