"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/ToastProvider"
import { usePayrollBasePath } from "@/lib/payrollBasePathContext"
import {
  defaultFortnightlyEnd,
  defaultWeeklyEnd,
  monthBoundsFromAnchor,
  PAYROLL_RUN_TYPES,
  type PayrollRunType,
} from "@/lib/payroll/payrollPeriodUtils"
import {
  PHASE_1B_PAYROLL_FREQUENCIES,
  type Phase1BPayrollFrequency,
} from "@/lib/payroll/salaryBasis"

type StaffRow = {
  id: string
  salary_basis?: string | null
  status?: string | null
}

export default function PayrollRunPage() {
  const router = useRouter()
  const payrollBase = usePayrollBasePath()
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [staff, setStaff] = useState<StaffRow[]>([])

  const defaultMonthStart = useMemo(() => {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)
  }, [])

  const [formData, setFormData] = useState({
    payroll_frequency: "monthly" as Phase1BPayrollFrequency,
    run_type: "regular" as PayrollRunType,
    pay_period_start: defaultMonthStart,
    pay_period_end: monthBoundsFromAnchor(defaultMonthStart).end,
  })

  useEffect(() => {
    ;(async () => {
      try {
        const response = await fetch("/api/staff/list?status=active")
        const data = await response.json()
        if (response.ok) {
          setStaff(data.staff || [])
        }
      } catch {
        // Eligibility hints are best-effort; server enforces on create.
      }
    })()
  }, [])

  const eligibleCounts = useMemo(() => {
    const counts = { monthly: 0, weekly: 0, fortnightly: 0 }
    for (const member of staff) {
      const basis = String(member.salary_basis || "monthly").toLowerCase()
      if (basis === "weekly") counts.weekly += 1
      else if (basis === "fortnightly") counts.fortnightly += 1
      else counts.monthly += 1
    }
    return counts
  }, [staff])

  const updatePeriodStart = (start: string) => {
    const frequency = formData.payroll_frequency
    let end = formData.pay_period_end
    if (frequency === "monthly") end = monthBoundsFromAnchor(start).end
    else if (frequency === "weekly") end = defaultWeeklyEnd(start)
    else if (frequency === "fortnightly") end = defaultFortnightlyEnd(start)
    setFormData((prev) => ({ ...prev, pay_period_start: start, pay_period_end: end }))
  }

  const updateFrequency = (frequency: Phase1BPayrollFrequency) => {
    const start = formData.pay_period_start
    let end = formData.pay_period_end
    if (frequency === "monthly") end = monthBoundsFromAnchor(start).end
    else if (frequency === "weekly") end = defaultWeeklyEnd(start)
    else if (frequency === "fortnightly") end = defaultFortnightlyEnd(start)
    setFormData((prev) => ({ ...prev, payroll_frequency: frequency, pay_period_end: end }))
  }

  const eligibleForSelected = eligibleCounts[formData.payroll_frequency]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (eligibleForSelected === 0) {
      toast.showToast(
        `No eligible employees for ${formData.payroll_frequency} payroll. Set matching salary basis on staff first.`,
        "error"
      )
      return
    }
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
            Only employees whose salary basis matches the pay frequency are included. Incompatible
            employees are excluded with a reason.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700 space-y-5"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                Pay frequency
              </span>
              <select
                value={formData.payroll_frequency}
                onChange={(e) => updateFrequency(e.target.value as Phase1BPayrollFrequency)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                {PHASE_1B_PAYROLL_FREQUENCIES.map((value) => (
                  <option key={value} value={value} disabled={eligibleCounts[value] === 0}>
                    {value.charAt(0).toUpperCase() + value.slice(1)}
                    {` (${eligibleCounts[value]} eligible)`}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                Run type
              </span>
              <select
                value={formData.run_type}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, run_type: e.target.value as PayrollRunType }))
                }
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                {PAYROLL_RUN_TYPES.filter((t) => t === "regular" || t === "bonus").map((value) => (
                  <option key={value} value={value}>
                    {value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-sm text-gray-500 dark:text-gray-400">
            Custom payroll periods are not yet available.
          </p>

          {formData.payroll_frequency !== "monthly" && (
            <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
              Ghana statutory approval is blocked for {formData.payroll_frequency} runs while PAYE
              bands remain monthly. You can create and review a draft, but you cannot approve it yet.
            </p>
          )}

          {eligibleForSelected === 0 && (
            <p className="text-sm text-red-700 dark:text-red-300">
              No eligible employees for {formData.payroll_frequency} payroll. Set staff salary basis
              to {formData.payroll_frequency} first.
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                Period start *
              </span>
              <input
                type="date"
                required
                value={formData.pay_period_start}
                onChange={(e) => updatePeriodStart(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                Period end *
              </span>
              <input
                type="date"
                required
                value={formData.pay_period_end}
                readOnly
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white opacity-80"
              />
            </label>
          </div>

          <p className="text-sm text-gray-500 dark:text-gray-400">
            Eligible employees are included by default. After creating the run, you can apply
            manual salary adjustments with a required reason, or assign one-off items to this draft
            run.
          </p>

          <div className="flex gap-4">
            <button
              type="submit"
              disabled={loading || eligibleForSelected === 0}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Creating…" : "Create payroll run"}
            </button>
            <button
              type="button"
              onClick={() => router.push(payrollBase)}
              className="px-6 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-200"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
