"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import TierGate from "@/components/service/TierGate"
import LoadingScreen from "@/components/ui/LoadingScreen"
import { StatusBadge } from "@/components/ui/StatusBadge"
import { exportToCSV, exportToExcel, ExportColumn, formatCurrencyRaw, formatDate } from "@/lib/exportUtils"
import Button from "@/components/ui/Button"
import { useToast } from "@/components/ui/ToastProvider"
import { useConfirm } from "@/components/ui/ConfirmProvider"
import type { LedgerLine } from "@/app/api/vat-returns/monthly/route"

type VatReturn = {
  id: string
  period_start_date: string
  period_end_date: string
  status: string
  total_taxable_sales: number
  total_output_nhil: number
  total_output_getfund: number
  total_output_covid: number
  total_output_vat: number
  total_output_tax: number
  total_taxable_purchases: number
  total_input_nhil: number
  total_input_getfund: number
  total_input_covid: number
  total_input_vat: number
  total_input_tax: number
  net_vat_payable: number
  net_vat_refund: number
  output_adjustment: number
  input_adjustment: number
  adjustment_reason: string | null
  submission_date: string | null
  payment_date: string | null
  payment_reference: string | null
  notes: string | null
  ledger_authority?: boolean
}

export default function VatReturnViewPage() {
  const router = useRouter()
  const params = useParams()
  const returnId = params.id as string
  const toast = useToast()
  const { openConfirm } = useConfirm()
  const [loading, setLoading] = useState(true)
  const [vatReturn, setVatReturn] = useState<VatReturn | null>(null)
  const [ledgerEntries, setLedgerEntries] = useState<LedgerLine[]>([])
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    loadReturn()
  }, [returnId])

  const loadReturn = async () => {
    try {
      const response = await fetch(`/api/vat-returns/${returnId}`)
      const data = await response.json()

      if (response.ok) {
        setVatReturn(data.vatReturn)

        // Fetch ledger entries for this period from the monthly endpoint
        const startMonth = (data.vatReturn.period_start_date as string).substring(0, 7)
        const endMonth = (data.vatReturn.period_end_date as string).substring(0, 7)
        try {
          const monthlyRes = await fetch("/api/vat-returns/monthly")
          if (monthlyRes.ok) {
            const monthlyData = await monthlyRes.json()
            const entries: LedgerLine[] = []
            for (const m of (monthlyData.monthlyReturns || [])) {
              if (m.month >= startMonth && m.month <= endMonth) {
                entries.push(...(m.entries || []))
              }
            }
            setLedgerEntries(entries)
          }
        } catch {
          // non-critical — ledger entries will just be empty
        }
      } else {
        console.error("Error loading VAT return:", data.error)
      }
    } catch (error) {
      console.error("Error loading VAT return:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleStatusUpdate = async (newStatus: string) => {
    setUpdating(true)
    try {
      const updateData: any = { status: newStatus }
      if (newStatus === "submitted" && !vatReturn?.submission_date) {
        updateData.submission_date = new Date().toISOString().split("T")[0]
      }
      if (newStatus === "paid" && !vatReturn?.payment_date) {
        updateData.payment_date = new Date().toISOString().split("T")[0]
      }

      const response = await fetch(`/api/vat-returns/${returnId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      })

      const data = await response.json()

      if (response.ok) {
        loadReturn()
      } else {
        toast.showToast(data.error || "Error updating VAT return", "error")
      }
    } catch (error) {
      console.error("Error updating VAT return:", error)
      toast.showToast("Error updating VAT return", "error")
    } finally {
      setUpdating(false)
    }
  }

  const handleRecalculate = async () => {
    if (!vatReturn) return
    openConfirm({
      title: "Recalculate VAT return",
      description:
        "This will re-read the tax control accounts (2100–2130) from the immutable ledger for this period and update all totals. Continue?",
      onConfirm: () => runRecalculate(),
    })
  }

  const runRecalculate = async () => {
    if (!vatReturn) return
    setUpdating(true)
    try {
      const calcResponse = await fetch("/api/vat-returns/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period_start_date: vatReturn.period_start_date,
          period_end_date: vatReturn.period_end_date,
        }),
      })

      if (!calcResponse.ok) {
        const calcError = await calcResponse.json()
        toast.showToast(calcError.error || "Error recalculating VAT", "error")
        return
      }

      const calcData = await calcResponse.json()
      const { calculation } = calcData

      const updateData = {
        total_taxable_sales: calculation.total_taxable_sales,
        total_output_nhil: calculation.total_output_nhil,
        total_output_getfund: calculation.total_output_getfund,
        total_output_covid: calculation.total_output_covid,
        total_output_vat: calculation.total_output_vat,
        total_output_tax: calculation.total_output_tax,
        total_taxable_purchases: calculation.total_taxable_purchases,
        total_input_nhil: calculation.total_input_nhil,
        total_input_getfund: calculation.total_input_getfund,
        total_input_covid: calculation.total_input_covid,
        total_input_vat: calculation.total_input_vat,
        total_input_tax: calculation.total_input_tax,
        net_vat_payable: calculation.net_vat_payable,
        net_vat_refund: calculation.net_vat_refund,
        output_adjustment: 0,
        input_adjustment: 0,
        adjustment_reason: null,
      }

      const response = await fetch(`/api/vat-returns/${returnId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      })

      const data = await response.json()

      if (response.ok) {
        toast.showToast("VAT return recalculated from ledger successfully!", "success")
        loadReturn()
      } else {
        toast.showToast(data.error || "Error recalculating VAT return", "error")
      }
    } catch (error) {
      console.error("Error recalculating VAT return:", error)
      toast.showToast("Error recalculating VAT return", "error")
    } finally {
      setUpdating(false)
    }
  }

  // Export ledger entries
  type LedgerExportRow = {
    date: string
    source: string
    description: string
    tax_code: string
    credit: number
    debit: number
  }

  const prepareLedgerExportData = (): LedgerExportRow[] =>
    ledgerEntries.map((e) => ({
      date: e.date,
      source: e.reference_type
        ? `${e.reference_type.replace(/_/g, " ")}${e.reference_id ? ` #${e.reference_id}` : ""}`
        : (e.source_type?.replace(/_/g, " ") || "—"),
      description: e.description || "—",
      tax_code: e.tax_code,
      credit: Number(e.credit) || 0,
      debit: Number(e.debit) || 0,
    }))

  const handleExportCSV = () => {
    const exportData = prepareLedgerExportData()
    if (exportData.length === 0) {
      toast.showToast("No ledger entries to export for this period", "warning")
      return
    }
    try {
      const columns: ExportColumn<LedgerExportRow>[] = [
        { header: "Date", accessor: (r) => formatDate(r.date), width: 15 },
        { header: "Source", accessor: (r) => r.source, width: 25 },
        { header: "Description", accessor: (r) => r.description, width: 40 },
        { header: "Tax Code", accessor: (r) => r.tax_code, width: 12 },
        { header: "Output (Credit)", accessor: (r) => r.credit, formatter: formatCurrencyRaw, excelType: "number", width: 16 },
        { header: "Input (Debit)", accessor: (r) => r.debit, formatter: formatCurrencyRaw, excelType: "number", width: 14 },
      ]
      exportToCSV(exportData, columns, `vat-ledger-${vatReturn?.period_start_date}-${vatReturn?.period_end_date}`)
    } catch (error: any) {
      toast.showToast(error.message || "Failed to export", "error")
    }
  }

  const handleExportExcel = async () => {
    const exportData = prepareLedgerExportData()
    if (exportData.length === 0) {
      toast.showToast("No ledger entries to export for this period", "warning")
      return
    }
    try {
      const columns: ExportColumn<LedgerExportRow>[] = [
        { header: "Date", accessor: (r) => r.date, formatter: (v) => (v ? formatDate(v) : ""), excelType: "date", width: 15 },
        { header: "Source", accessor: (r) => r.source, width: 25 },
        { header: "Description", accessor: (r) => r.description, width: 40 },
        { header: "Tax Code", accessor: (r) => r.tax_code, width: 12 },
        { header: "Output (Credit)", accessor: (r) => r.credit, formatter: formatCurrencyRaw, excelType: "number", width: 16 },
        { header: "Input (Debit)", accessor: (r) => r.debit, formatter: formatCurrencyRaw, excelType: "number", width: 14 },
      ]
      await exportToExcel(exportData, columns, `vat-ledger-${vatReturn?.period_start_date}-${vatReturn?.period_end_date}`)
    } catch (error: any) {
      toast.showToast(error.message || "Failed to export", "error")
    }
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <LoadingScreen />
      </ProtectedLayout>
    )
  }

  if (!vatReturn) {
    return (
      <ProtectedLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <p className="text-gray-500 mb-4">VAT return not found.</p>
            <button
              onClick={() => router.push("/vat-returns")}
              className="text-blue-600 hover:underline text-sm"
            >
              Back to VAT Returns
            </button>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  const formatPeriod = (start: string) =>
    new Date(start).toLocaleDateString("en-GH", { month: "long", year: "numeric" })

  // Compute totals — handle legacy rows where total_output_tax may be 0
  const outputTax =
    Number(vatReturn.total_output_tax) ||
    (Number(vatReturn.total_output_nhil || 0) +
      Number(vatReturn.total_output_getfund || 0) +
      Number(vatReturn.total_output_covid || 0) +
      Number(vatReturn.total_output_vat || 0))

  const inputTax =
    Number(vatReturn.total_input_tax) ||
    (Number(vatReturn.total_input_nhil || 0) +
      Number(vatReturn.total_input_getfund || 0) +
      Number(vatReturn.total_input_covid || 0) +
      Number(vatReturn.total_input_vat || 0))

  const adjustedOutput = outputTax + Number(vatReturn.output_adjustment || 0)
  const adjustedInput = inputTax + Number(vatReturn.input_adjustment || 0)
  const netPayable = Math.max(adjustedOutput - adjustedInput, 0)
  const netRefund = Math.max(adjustedInput - adjustedOutput, 0)

  const entrySourceLabel = (e: LedgerLine) => {
    if (e.reference_type)
      return `${e.reference_type.replace(/_/g, " ")}${e.reference_id ? ` #${e.reference_id}` : ""}`
    if (e.source_type) return e.source_type.replace(/_/g, " ")
    return "—"
  }

  return (
    <TierGate minTier="professional">
    <ProtectedLayout>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-5xl mx-auto">

          {/* Header */}
          <div className="mb-6">
            <button
              onClick={() => router.push("/vat-returns")}
              className="group flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors mb-4"
            >
              <svg className="w-4 h-4 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to VAT Returns
            </button>

            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  VAT Return — {formatPeriod(vatReturn.period_start_date)}
                </h1>
                <div className="flex items-center gap-3 flex-wrap">
                  <StatusBadge status={vatReturn.status} />
                  <span className="text-xs font-mono text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800">
                    LEDGER SOURCE ✓
                  </span>
                  <span className="text-xs text-slate-400">
                    {vatReturn.period_start_date} → {vatReturn.period_end_date}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {vatReturn.status === "draft" && (
                  <button
                    onClick={handleRecalculate}
                    disabled={updating}
                    className="px-4 py-2 bg-amber-100 text-amber-800 border border-amber-300 rounded-lg text-sm font-medium hover:bg-amber-200 disabled:opacity-50 transition-colors"
                  >
                    {updating ? "Recalculating..." : "↻ Recalculate"}
                  </button>
                )}
                <Button
                  onClick={handleExportCSV}
                  leftIcon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  }
                >
                  CSV
                </Button>
                <Button
                  onClick={handleExportExcel}
                  variant="outline"
                  leftIcon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  }
                >
                  Excel
                </Button>
                {vatReturn.status === "draft" && (
                  <button
                    onClick={() => handleStatusUpdate("submitted")}
                    disabled={updating}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    Mark Submitted
                  </button>
                )}
                {vatReturn.status === "submitted" && (
                  <button
                    onClick={() => handleStatusUpdate("paid")}
                    disabled={updating}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    Mark Paid
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Output / Input Tax cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-gray-200 dark:border-gray-700">
              <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500 inline-block shrink-0"></span>
                Output Tax (Sales)
              </h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-gray-500">
                  <span>Taxable Sales (derived)</span>
                  <span className="font-medium text-gray-700">₵{Number(vatReturn.total_taxable_sales).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>NHIL (2.5%)</span>
                  <span>₵{Number(vatReturn.total_output_nhil).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>GETFund (2.5%)</span>
                  <span>₵{Number(vatReturn.total_output_getfund).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>VAT (15%)</span>
                  <span>₵{Number(vatReturn.total_output_vat).toFixed(2)}</span>
                </div>
                <div className="pt-2 border-t border-gray-200 dark:border-gray-700 flex justify-between font-bold text-gray-900 dark:text-white">
                  <span>Total Output Tax</span>
                  <span className="text-lg">₵{outputTax.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-gray-200 dark:border-gray-700">
              <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block shrink-0"></span>
                Input Tax (Purchases)
              </h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-gray-500">
                  <span>Taxable Purchases (derived)</span>
                  <span className="font-medium text-gray-700">₵{Number(vatReturn.total_taxable_purchases).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>NHIL (2.5%)</span>
                  <span>₵{Number(vatReturn.total_input_nhil).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>GETFund (2.5%)</span>
                  <span>₵{Number(vatReturn.total_input_getfund).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>VAT (15%)</span>
                  <span>₵{Number(vatReturn.total_input_vat).toFixed(2)}</span>
                </div>
                <div className="pt-2 border-t border-gray-200 dark:border-gray-700 flex justify-between font-bold text-gray-900 dark:text-white">
                  <span>Total Input Tax</span>
                  <span className="text-lg">₵{inputTax.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Net VAT */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl shadow-sm p-6 border-2 border-blue-200 dark:border-blue-800 mb-6">
            <div className="flex justify-between items-center flex-wrap gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Net VAT</h2>
                {(Number(vatReturn.output_adjustment) !== 0 || Number(vatReturn.input_adjustment) !== 0) && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Adjustments: Output {Number(vatReturn.output_adjustment) > 0 ? "+" : ""}
                    {Number(vatReturn.output_adjustment).toFixed(2)}, Input {Number(vatReturn.input_adjustment) > 0 ? "+" : ""}
                    {Number(vatReturn.input_adjustment).toFixed(2)}
                    {vatReturn.adjustment_reason && ` — ${vatReturn.adjustment_reason}`}
                  </p>
                )}
              </div>
              <div className="text-right">
                {netPayable > 0 ? (
                  <>
                    <p className="text-xs text-gray-500 mb-1">Net VAT Payable (to GRA)</p>
                    <p className="text-3xl font-bold text-red-600 dark:text-red-400">₵{netPayable.toFixed(2)}</p>
                  </>
                ) : netRefund > 0 ? (
                  <>
                    <p className="text-xs text-gray-500 mb-1">Net VAT Refund Due</p>
                    <p className="text-3xl font-bold text-green-600 dark:text-green-400">₵{netRefund.toFixed(2)}</p>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-gray-500 mb-1">Net VAT Payable</p>
                    <p className="text-3xl font-bold text-gray-600 dark:text-gray-400">₵0.00</p>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Submission Details */}
          {(vatReturn.submission_date || vatReturn.payment_date || vatReturn.payment_reference) && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-gray-200 dark:border-gray-700 mb-6">
              <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4">Submission Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                {vatReturn.submission_date && (
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Submitted</p>
                    <p className="font-semibold text-gray-900 dark:text-white">
                      {new Date(vatReturn.submission_date).toLocaleDateString("en-GH")}
                    </p>
                  </div>
                )}
                {vatReturn.payment_date && (
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Payment Date</p>
                    <p className="font-semibold text-gray-900 dark:text-white">
                      {new Date(vatReturn.payment_date).toLocaleDateString("en-GH")}
                    </p>
                  </div>
                )}
                {vatReturn.payment_reference && (
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Payment Reference</p>
                    <p className="font-semibold font-mono text-gray-900 dark:text-white">{vatReturn.payment_reference}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Ledger Entries */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-gray-200 dark:border-gray-700 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-white">
                  Ledger Entries ({ledgerEntries.length})
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Journal entry lines on accounts 2100–2130 for this period
                </p>
              </div>
            </div>
            {ledgerEntries.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <svg className="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm">No journal entry lines found for this period on tax control accounts.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Date</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Source</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Description</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Tax</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Output (Credit)</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Input (Debit)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {ledgerEntries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {new Date(entry.date).toLocaleDateString("en-GH")}
                        </td>
                        <td className="px-4 py-2 text-gray-500 whitespace-nowrap text-xs">
                          {entrySourceLabel(entry)}
                        </td>
                        <td className="px-4 py-2 text-gray-700 dark:text-gray-300 max-w-xs truncate">
                          {entry.description || "—"}
                        </td>
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                            {entry.tax_code}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right font-medium text-blue-700 dark:text-blue-400">
                          {Number(entry.credit) > 0 ? `₵${Number(entry.credit).toFixed(2)}` : "—"}
                        </td>
                        <td className="px-4 py-2 text-right font-medium text-green-700 dark:text-green-400">
                          {Number(entry.debit) > 0 ? `₵${Number(entry.debit).toFixed(2)}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Notes */}
          {vatReturn.notes && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-gray-200 dark:border-gray-700">
              <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">Notes</h2>
              <p className="text-gray-700 dark:text-gray-300 text-sm">{vatReturn.notes}</p>
            </div>
          )}

        </div>
      </div>
    </ProtectedLayout>
    </TierGate>
  )
}
