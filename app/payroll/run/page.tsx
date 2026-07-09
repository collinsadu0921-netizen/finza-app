"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/ToastProvider"
import { usePayrollBasePath } from "@/lib/payrollBasePathContext"
import {
  defaultFortnightlyEnd,
  defaultWeeklyEnd,
  monthBoundsFromAnchor,
  PAYROLL_FREQUENCIES,
  PAYROLL_RUN_TYPES,
  type PayrollFrequency,
  type PayrollRunType,
} from "@/lib/payroll/payrollPeriodUtils"

export default function PayrollRunPage() {
  const router = useRouter()
  const payrollBase = usePayrollBasePath()
  const toast = useToast()
  const [loading, setLoading] = useState(false)

  const defaultMonthStart = useMemo(() => {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)
  }, [])

  const [formData, setFormData] = useState({
    payroll_frequency: "monthly" as PayrollFrequency,
    run_type: "regular" as PayrollRunType,
    pay_period_start: defaultMonthStart,
    pay_period_end: monthBoundsFromAnchor(defaultMonthStart).end,
  })

  const updatePeriodStart = (start: string) => {
    const frequency = formData.payroll_frequency
    let end = formData.pay_period_end
    if (frequency === "monthly") {
      end = monthBoundsFromAnchor(start).end
    } else if (frequency === "weekly") {
      end = defaultWeeklyEnd(start)
    } else if (frequency === "fortnightly") {
      end = defaultFortnightlyEnd(start)
    } else if (frequency === "daily") {
      end = start
    }
    setFormData((prev) => ({ ...prev, pay_period_start: start, pay_period_end: end }))
  }

  const updateFrequency = (frequency: PayrollFrequency) => {
    const start = formData.pay_period_start
    let end = formData.pay_period_end
    if (frequency === "monthly") {
      end = monthBoundsFromAnchor(start).end
    } else if (frequency === "weekly") {
      end = defaultWeeklyEnd(start)
    } else if (frequency === "fortnightly") {
      end = defaultFortnightlyEnd(start)
    } else if (frequency === "daily") {
      end = start
    }
    setFormData((prev) => ({ ...prev, payroll_frequency: frequency, pay_period_end: end }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await fetch("/api/payroll/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payroll_frequency: formData.payroll_frequency,
          run_type: formData.run_type,
          pay_period_start: formData.pay_period_start,
          pay_period_end: formData.pay_period_end,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        router.push(`${payrollBase}/${data.payrollRun.id}`)
      } else {
        toast.showToast(data.error || "Error creating payroll run", "error")
      }
    } catch (error) {
      console.error("Error creating payroll run:", error)
      toast.showToast("Error creating payroll run", "error")
    } finally {
      setLoading(false)
    }
  }

  const periodEndRequired =
    formData.payroll_frequency === "custom" || formData.payroll_frequency === "casual"

  return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <button
              onClick={() => router.push(payrollBase)}
              className="text-blue-600 dark:text-blue-400 hover:underline mb-2"
            >
              ← Back to Payroll
            </button>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Create Payroll Run</h1>
            <p className="text-gray-600 dark:text-gray-400">
              Set the pay period and run type. Monthly, weekly, bonus, and correction runs can coexist for the same calendar month when periods or types differ.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Pay frequency</span>
                <select
                  value={formData.payroll_frequency}
                  onChange={(e) => updateFrequency(e.target.value as PayrollFrequency)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  {PAYROLL_FREQUENCIES.map((value) => (
                    <option key={value} value={value}>
                      {value.charAt(0).toUpperCase() + value.slice(1)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Run type</span>
                <select
                  value={formData.run_type}
                  onChange={(e) => setFormData((prev) => ({ ...prev, run_type: e.target.value as PayrollRunType }))}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  {PAYROLL_RUN_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Period start *</span>
                <input
                  type="date"
                  required
                  value={formData.pay_period_start}
                  onChange={(e) => updatePeriodStart(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Period end *</span>
                <input
                  type="date"
                  required
                  value={formData.pay_period_end}
                  onChange={(e) => setFormData((prev) => ({ ...prev, pay_period_end: e.target.value }))}
                  readOnly={!periodEndRequired}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white read-only:opacity-80"
                />
              </label>
            </div>

            <p className="text-sm text-gray-500 dark:text-gray-400">
              All active employees are included by default. After creating the run, you can exclude staff or apply one-off salary adjustments before approval.
            </p>

            <div className="flex gap-4">
              <button
                type="submit"
                disabled={loading}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
              >
                {loading ? "Creating..." : "Create Payroll Run"}
              </button>
              <button
                type="button"
                onClick={() => router.push(payrollBase)}
                className="px-6 py-3 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
  )
}
