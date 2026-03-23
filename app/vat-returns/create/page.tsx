"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useToast } from "@/components/ui/ToastProvider"
import TierGate from "@/components/service/TierGate"

function CreateVatReturnContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [calculation, setCalculation] = useState<any>(null)
  const [formData, setFormData] = useState({
    period_start_date: searchParams.get("start") || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0],
    period_end_date: searchParams.get("end") || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split("T")[0],
    output_adjustment: "0",
    input_adjustment: "0",
    adjustment_reason: "",
    notes: "",
  })

  useEffect(() => {
    if (formData.period_start_date && formData.period_end_date) {
      calculateVat()
    }
  }, [formData.period_start_date, formData.period_end_date])

  // Returns the calculation result directly so callers don't depend on stale state
  const calculateVat = async (): Promise<any | null> => {
    setCalculating(true)
    try {
      const response = await fetch("/api/vat-returns/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period_start_date: formData.period_start_date,
          period_end_date: formData.period_end_date,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setCalculation(data.calculation)
        return data.calculation
      } else {
        toast.showToast(data.error || "Error calculating VAT", "error")
        return null
      }
    } catch (error) {
      console.error("Error calculating VAT:", error)
      toast.showToast("Error calculating VAT", "error")
      return null
    } finally {
      setCalculating(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.period_start_date || !formData.period_end_date) {
      toast.showToast("Please select a period first", "warning")
      return
    }

    setLoading(true)
    try {
      // Use existing calculation or fetch a fresh one — no setTimeout race
      const calc = calculation ?? (await calculateVat())
      if (!calc) {
        toast.showToast("Calculation failed — please try again", "error")
        setLoading(false)
        return
      }

      const response = await fetch("/api/vat-returns/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (response.ok) {
        router.push(`/vat-returns/${data.vatReturn.id}`)
      } else {
        toast.showToast(data.error || "Error creating VAT return", "error")
      }
    } catch (error) {
      console.error("Error creating VAT return:", error)
      toast.showToast("Error creating VAT return", "error")
    } finally {
      setLoading(false)
    }
  }

  const adjustedOutputTax = calculation
    ? calculation.total_output_tax + Number(formData.output_adjustment || 0)
    : 0
  const adjustedInputTax = calculation
    ? calculation.total_input_tax + Number(formData.input_adjustment || 0)
    : 0
  const netVatPayable = Math.max(adjustedOutputTax - adjustedInputTax, 0)
  const netVatRefund = Math.max(adjustedInputTax - adjustedOutputTax, 0)

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gray-50/50 dark:bg-gray-950 pb-20 font-sans">
        <div className="max-w-3xl mx-auto px-4 py-6">

          {/* Back + badge */}
          <div className="flex items-center gap-3 mb-6">
            <button
              type="button"
              onClick={() => router.back()}
              className="group flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
            >
              <svg
                className="w-4 h-4 transition-transform group-hover:-translate-x-0.5"
                fill="none" stroke="currentColor" strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              VAT Returns
            </button>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <span className="font-mono text-xs tracking-widest text-slate-400 uppercase">
              New Return
            </span>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Document card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-slate-200 dark:border-gray-700 overflow-hidden">

              {/* Card header */}
              <div className="px-6 py-4 border-b border-slate-100 dark:border-gray-700 flex items-center justify-between">
                <h1 className="text-lg font-semibold text-slate-800 dark:text-white tracking-tight">
                  Create VAT Return
                </h1>
                {calculating && (
                  <span className="flex items-center gap-1.5 text-xs text-slate-400">
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    Calculating…
                  </span>
                )}
              </div>

              {/* Period Selection */}
              <div className="px-6 py-5 border-b border-slate-100 dark:border-gray-700">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">Period</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                      Month &amp; Year
                    </label>
                    <input
                      type="month"
                      value={formData.period_start_date.substring(0, 7)}
                      onChange={(e) => {
                        const yearMonth = e.target.value
                        const startDate = `${yearMonth}-01`
                        const endDate = new Date(
                          new Date(yearMonth + "-01").getFullYear(),
                          new Date(yearMonth + "-01").getMonth() + 1,
                          0
                        ).toISOString().split("T")[0]
                        setFormData({ ...formData, period_start_date: startDate, period_end_date: endDate })
                      }}
                      className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                      Start Date <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={formData.period_start_date}
                      onChange={(e) => setFormData({ ...formData, period_start_date: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                      End Date <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={formData.period_end_date}
                      onChange={(e) => setFormData({ ...formData, period_end_date: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300"
                    />
                  </div>
                </div>
              </div>

              {calculation && (
                <>
                  {/* Output Tax */}
                  <div className="px-6 py-5 border-b border-slate-100 dark:border-gray-700">
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">
                      Taxable Sales &amp; Output Tax
                    </p>
                    <div className="space-y-1 text-sm">
                      {[
                        { label: "Taxable Sales", value: calculation.total_taxable_sales },
                        { label: "NHIL (2.5%)", value: calculation.total_output_nhil },
                        { label: "GETFund (2.5%)", value: calculation.total_output_getfund },
                        { label: "VAT (15%)", value: calculation.total_output_vat },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex justify-between py-1.5 border-b border-slate-50 dark:border-gray-700/50">
                          <span className="text-slate-600 dark:text-slate-400">{label}</span>
                          <span className="text-slate-800 dark:text-white">₵{Number(value || 0).toFixed(2)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between pt-2">
                        <span className="font-semibold text-slate-800 dark:text-white">Total Output Tax</span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          ₵{Number(calculation.total_output_tax || 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Input Tax */}
                  <div className="px-6 py-5 border-b border-slate-100 dark:border-gray-700">
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">
                      Taxable Purchases &amp; Input Tax
                    </p>
                    <div className="space-y-1 text-sm">
                      {[
                        { label: "Taxable Purchases", value: calculation.total_taxable_purchases },
                        { label: "NHIL (2.5%)", value: calculation.total_input_nhil },
                        { label: "GETFund (2.5%)", value: calculation.total_input_getfund },
                        { label: "VAT (15%)", value: calculation.total_input_vat },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex justify-between py-1.5 border-b border-slate-50 dark:border-gray-700/50">
                          <span className="text-slate-600 dark:text-slate-400">{label}</span>
                          <span className="text-slate-800 dark:text-white">₵{Number(value || 0).toFixed(2)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between pt-2">
                        <span className="font-semibold text-slate-800 dark:text-white">Total Input Tax</span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          ₵{Number(calculation.total_input_tax || 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Adjustments */}
                  <div className="px-6 py-5 border-b border-slate-100 dark:border-gray-700">
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">
                      Adjustments
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                          Output Tax Adjustment (₵)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={formData.output_adjustment}
                          onChange={(e) => setFormData({ ...formData, output_adjustment: e.target.value })}
                          className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                          Input Tax Adjustment (₵)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={formData.input_adjustment}
                          onChange={(e) => setFormData({ ...formData, input_adjustment: e.target.value })}
                          className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                        Adjustment Reason
                      </label>
                      <textarea
                        value={formData.adjustment_reason}
                        onChange={(e) => setFormData({ ...formData, adjustment_reason: e.target.value })}
                        rows={2}
                        placeholder="Reason for adjustments (e.g., rounding, corrections)"
                        className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
                      />
                    </div>
                  </div>

                  {/* Net VAT Summary */}
                  <div className="px-6 py-5 border-b border-slate-100 dark:border-gray-700 bg-slate-50 dark:bg-gray-800/60">
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">
                      Net VAT Summary
                    </p>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between py-1.5">
                        <span className="text-slate-600 dark:text-slate-400">Adjusted Output Tax</span>
                        <span className="text-slate-800 dark:text-white">₵{adjustedOutputTax.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-slate-200 dark:border-gray-600">
                        <span className="text-slate-600 dark:text-slate-400">Adjusted Input Tax</span>
                        <span className="text-slate-800 dark:text-white">₵{adjustedInputTax.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between pt-3">
                        {netVatPayable > 0 ? (
                          <>
                            <span className="font-bold text-red-600 dark:text-red-400">Net VAT Payable</span>
                            <span className="font-bold text-xl text-red-600 dark:text-red-400">
                              ₵{netVatPayable.toFixed(2)}
                            </span>
                          </>
                        ) : netVatRefund > 0 ? (
                          <>
                            <span className="font-bold text-green-600 dark:text-green-400">Net VAT Refund Due</span>
                            <span className="font-bold text-xl text-green-600 dark:text-green-400">
                              ₵{netVatRefund.toFixed(2)}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="font-bold text-slate-500 dark:text-slate-400">Net VAT Payable</span>
                            <span className="font-bold text-xl text-slate-500 dark:text-slate-400">₵0.00</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="px-6 py-5">
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                      Notes
                    </label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      rows={3}
                      placeholder="Internal notes for this return"
                      className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Sticky footer */}
            <div className="fixed bottom-0 left-0 right-0 z-10 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border-t border-slate-200 dark:border-gray-700">
              <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => router.back()}
                  className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <span className="w-px h-4 bg-slate-200 dark:bg-gray-600" />
                <button
                  type="submit"
                  disabled={loading || calculating || !calculation}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-md hover:bg-slate-700 dark:hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? (
                    <>
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      Saving…
                    </>
                  ) : (
                    "Create Return →"
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </ProtectedLayout>
  )
}

export default function CreateVatReturnPage() {
  return (
    <TierGate minTier="professional">
      <Suspense fallback={<div>Loading...</div>}>
        <CreateVatReturnContent />
      </Suspense>
    </TierGate>
  )
}
