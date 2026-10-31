"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { usePayrollBasePath } from "@/lib/payrollBasePathContext"
import { useServiceFinancialWrite } from "@/components/service/useServiceFinancialWrite"
import ServiceReadOnlyNotice from "@/components/service/ServiceReadOnlyNotice"
import { formatPayrollRunLabel, formatPayrollRunTypeBadge } from "@/lib/payroll/payrollRunLabels"
import {
  PAYROLL_DRAFT_DELETE_CONFIRM,
  canShowPayrollDraftDelete,
  requestDeleteDraftPayrollRun,
} from "@/lib/payroll/payrollDraftDeleteUi"
import { useConfirm } from "@/components/ui/ConfirmProvider"
import { useToast } from "@/components/ui/ToastProvider"
type PayrollRun = {
  id: string
  payroll_month: string
  pay_period_start?: string
  pay_period_end?: string
  payroll_frequency?: string
  run_type?: string
  status: string
  total_net_salary: number
  total_gross_salary: number
  total_paye: number
  pension_limits_provisional?: boolean | null
  provisional_ssnit_acknowledged_at?: string | null
  created_at: string
}

export default function PayrollPage() {
  const router = useRouter()
  const payrollBase = usePayrollBasePath()
  const { readOnly, guardWriteAction } = useServiceFinancialWrite("payroll")
  const { openConfirm } = useConfirm()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null)

  useEffect(() => {
    loadPayrollRuns()
  }, [])

  const loadPayrollRuns = async () => {
    try {
      const response = await fetch("/api/payroll/runs")
      const data = await response.json()

      if (response.ok) {
        setRuns(data.runs || [])
      } else {
        console.error("Error loading payroll runs:", data.error)
      }
    } catch (error) {
      console.error("Error loading payroll runs:", error)
    } finally {
      setLoading(false)
    }
  }

  const runDeleteDraftFromList = async (runId: string) => {
    setDeletingRunId(runId)
    try {
      const result = await requestDeleteDraftPayrollRun(runId)
      if (!result.ok) {
        toast.showToast(result.error, "error")
        return
      }
      setRuns((prev) => prev.filter((r) => r.id !== runId))
      toast.showToast("Draft payroll deleted", "success")
    } catch {
      toast.showToast("Could not delete draft payroll run", "error")
    } finally {
      setDeletingRunId(null)
    }
  }

  const handleDeleteDraftFromList = (run: PayrollRun) => {
    openConfirm({
      ...PAYROLL_DRAFT_DELETE_CONFIRM,
      onConfirm: () => runDeleteDraftFromList(run.id),
    })
  }

  if (loading) {
    return (
      <div className="p-6">
        <p>Loading...</p>
      </div>
    )
  }

  const formatMonth = (run: PayrollRun) => formatPayrollRunLabel(run)

  const renderStatusBadges = (run: PayrollRun) => (
    <div className="flex flex-wrap items-center gap-1">
      <span
        className={`px-2 py-1 text-[11px] font-semibold rounded-full ${
          run.status === "approved"
            ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
            : run.status === "locked"
            ? "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200"
            : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
        }`}
      >
        {run.status}
      </span>
      {run.pension_limits_provisional ? (
        <span className="px-2 py-1 text-[11px] font-semibold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          SSNIT provisional
        </span>
      ) : null}
    </div>
  )

  const renderRunActions = (run: PayrollRun) => (
    <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <button
        type="button"
        onClick={() => router.push(`${payrollBase}/${run.id}`)}
        className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
      >
        View
      </button>
      {!readOnly && canShowPayrollDraftDelete(run.status) ? (
        <button
          type="button"
          disabled={deletingRunId === run.id}
          onClick={() => guardWriteAction(() => handleDeleteDraftFromList(run))}
          className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 disabled:opacity-50"
        >
          {deletingRunId === run.id ? "Deleting…" : "Delete draft"}
        </button>
      ) : null}
    </div>
  )

  return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 pb-28 sm:p-6 sm:pb-28">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Payroll Runs</h1>
              <p className="text-gray-600 dark:text-gray-400">Manage payroll runs and processing</p>
            </div>
            {!readOnly && (
              <button
                onClick={() => guardWriteAction(() => router.push(`${payrollBase}/run`))}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 sm:w-auto"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Payroll Run
              </button>
            )}
          </div>

          {readOnly && <ServiceReadOnlyNotice scope="payroll" className="mb-4" />}

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="hidden md:block">
              <table className="w-full table-fixed">
                <colgroup>
                  <col className="w-[20%]" />
                  <col className="w-[11%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                  <col className="w-[12%]" />
                  <col className="w-[17%]" />
                  <col className="w-[18%]" />
                </colgroup>
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-3 py-3 text-left text-[11px] font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wide">
                      Period
                    </th>
                    <th className="px-3 py-3 text-left text-[11px] font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wide">
                      Type
                    </th>
                    <th className="px-3 py-3 text-right text-[11px] font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wide">
                      Gross Salary
                    </th>
                    <th className="px-3 py-3 text-right text-[11px] font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wide">
                      PAYE
                    </th>
                    <th className="px-3 py-3 text-right text-[11px] font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wide">
                      Net Salary
                    </th>
                    <th className="px-3 py-3 text-left text-[11px] font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wide">
                      Status
                    </th>
                    <th className="px-3 py-3 pr-4 text-right text-[11px] font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wide">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {runs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                        No payroll runs found. Create your first payroll run to get started.
                      </td>
                    </tr>
                  ) : (
                    runs.map((run) => (
                      <tr key={run.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-3 py-3 align-top text-sm font-medium text-gray-900 dark:text-white break-words whitespace-normal leading-snug">
                          {formatMonth(run)}
                        </td>
                        <td className="px-3 py-3 align-top text-xs text-gray-600 dark:text-gray-300 break-words">
                          {formatPayrollRunTypeBadge(run.run_type)}
                          {run.payroll_frequency && run.payroll_frequency !== "monthly" ? (
                            <span className="block text-[11px] text-gray-400">({run.payroll_frequency})</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 align-top text-right text-xs xl:text-sm tabular-nums whitespace-nowrap text-gray-900 dark:text-white">
                          ₵{Number(run.total_gross_salary || 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-3 align-top text-right text-xs xl:text-sm tabular-nums whitespace-nowrap text-gray-900 dark:text-white">
                          ₵{Number(run.total_paye || 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-3 align-top text-right text-xs xl:text-sm tabular-nums whitespace-nowrap text-gray-900 dark:text-white">
                          ₵{Number(run.total_net_salary || 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-3 align-top">{renderStatusBadges(run)}</td>
                        <td className="px-3 py-3 pr-4 align-top text-right">{renderRunActions(run)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-gray-200 dark:divide-gray-700">
              {runs.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  No payroll runs found. Create your first payroll run to get started.
                </p>
              ) : (
                runs.map((run) => (
                  <div key={run.id} className="p-4 space-y-3">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white break-words leading-snug">
                        {formatMonth(run)}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {formatPayrollRunTypeBadge(run.run_type)}
                        {run.payroll_frequency && run.payroll_frequency !== "monthly"
                          ? ` (${run.payroll_frequency})`
                          : ""}
                      </p>
                      {renderStatusBadges(run)}
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-gray-500 dark:text-gray-400">Gross</p>
                        <p className="font-medium tabular-nums text-gray-900 dark:text-white">
                          ₵{Number(run.total_gross_salary || 0).toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500 dark:text-gray-400">PAYE</p>
                        <p className="font-medium tabular-nums text-gray-900 dark:text-white">
                          ₵{Number(run.total_paye || 0).toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500 dark:text-gray-400">Net</p>
                        <p className="font-medium tabular-nums text-gray-900 dark:text-white">
                          ₵{Number(run.total_net_salary || 0).toFixed(2)}
                        </p>
                      </div>
                    </div>
                    <div className="border-t border-gray-100 dark:border-gray-700 pt-2">
                      {renderRunActions(run)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
  )
}


