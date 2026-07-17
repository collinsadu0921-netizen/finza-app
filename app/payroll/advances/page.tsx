"use client"

import { Fragment, useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/ToastProvider"
import { usePayrollBasePath } from "@/lib/payrollBasePathContext"
import { formatPayrollRunLabel } from "@/lib/payroll/payrollRunLabels"

type Advance = {
  id: string
  staff_id: string
  staff_name: string | null
  amount: number
  monthly_repayment: number
  date_issued: string
  bank_account_id: string | null
  bank_account_name?: string | null
  bank_account_code?: string | null
  notes: string | null
  repaid: number
  repaid_amount: number
  outstanding: number
  outstanding_amount: number
  status: "outstanding" | "partially_repaid" | "cleared" | "cancelled"
  cleared_at?: string | null
  repayments?: Repayment[]
  created_at: string
}

type Repayment = {
  id: string
  salary_advance_id: string
  payroll_run_id: string
  payroll_entry_id: string | null
  amount: number
  status: "pending" | "posted" | "voided"
  journal_entry_id: string | null
  posted_at: string | null
  created_at: string
  payroll_run?: {
    id: string
    payroll_month: string
    pay_period_start?: string
    pay_period_end?: string
    payroll_frequency?: string
    run_type?: string
  } | null
}

type StaffMember = {
  id: string
  name: string
  position: string | null
}

type BankAccount = {
  id: string
  name: string
  code: string
}

const today = () => new Date().toISOString().split("T")[0]

export default function SalaryAdvancesPage() {
  const router = useRouter()
  const payrollBase = usePayrollBasePath()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [advances, setAdvances] = useState<Advance[]>([])
  const [expandedAdvanceId, setExpandedAdvanceId] = useState<string | null>(null)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])

  const [form, setForm] = useState({
    staff_id: "",
    amount: "",
    monthly_repayment: "",
    date_issued: today(),
    bank_account_id: "",
    notes: "",
  })

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/payroll/advances")
      const data = await res.json()
      if (res.ok) {
        setAdvances(data.advances ?? [])
        setStaff(data.staff ?? [])
        setBankAccounts(data.bankAccounts ?? [])
        // Default to first bank account if none selected
        if (!form.bank_account_id && data.bankAccounts?.length > 0) {
          setForm((f) => ({ ...f, bank_account_id: data.bankAccounts[0].id }))
        }
      } else {
        toast.showToast(data.error || "Failed to load advances", "error")
      }
    } catch {
      toast.showToast("Failed to load advances", "error")
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.staff_id || !form.amount || !form.monthly_repayment || !form.date_issued || !form.bank_account_id) {
      toast.showToast("Please fill in all required fields", "error")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/payroll/advances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staff_id: form.staff_id,
          amount: parseFloat(form.amount),
          monthly_repayment: parseFloat(form.monthly_repayment),
          date_issued: form.date_issued,
          bank_account_id: form.bank_account_id,
          notes: form.notes || undefined,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        if (data.warning) {
          toast.showToast(`Advance issued — ${data.warning}`, "error")
        } else {
          toast.showToast("Salary advance issued and journal entry posted", "success")
        }
        setForm((f) => ({ ...f, staff_id: "", amount: "", monthly_repayment: "", notes: "" }))
        await load()
      } else {
        toast.showToast(data.error || "Failed to issue advance", "error")
      }
    } catch {
      toast.showToast("Failed to issue advance", "error")
    } finally {
      setSubmitting(false)
    }
  }

  const selectedBank = bankAccounts.find((a) => a.id === form.bank_account_id)
  const amountNum = parseFloat(form.amount) || 0

  const fmtDate = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" })

  const fmt = (n: number) => n.toFixed(2)
  const statusMeta = (status: Advance["status"]) => {
    switch (status) {
      case "cleared":
        return { label: "Cleared", cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" }
      case "partially_repaid":
        return { label: "Partially repaid", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" }
      case "cancelled":
        return { label: "Cancelled", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" }
      default:
        return { label: "Outstanding", cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400" }
    }
  }
  const repaymentStatusMeta = (status: Repayment["status"]) => {
    switch (status) {
      case "posted":
        return { label: "Posted", cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" }
      case "voided":
        return { label: "Voided", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" }
      default:
        return { label: "Pending", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400" }
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-500">Loading…</p>
      </div>
    )
  }

  return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-5xl mx-auto space-y-8">

          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <button
                onClick={() => router.push(payrollBase)}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-2 flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to Payroll
              </button>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Salary Advances</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Issue and track salary advances given to employees
              </p>
            </div>
          </div>

          {/* ── Advance Register ── */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Advance Register</h2>
            </div>
            {advances.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <svg className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <p className="text-gray-500 dark:text-gray-400 text-sm">No salary advances recorded yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Employee</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Amount</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Monthly</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Repaid</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Outstanding</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {advances.map((adv) => {
                      const meta = statusMeta(adv.status)
                      const repayments = adv.repayments ?? []
                      const isExpanded = expandedAdvanceId === adv.id
                      const outstanding = adv.outstanding_amount ?? adv.outstanding ?? 0
                      return (
                        <Fragment key={adv.id}>
                          <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                            <td className="px-5 py-3 font-medium text-gray-900 dark:text-white">
                              <div className="flex items-center gap-2">
                                <span>{adv.staff_name ?? "—"}</span>
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${meta.cls}`}>
                                  {meta.label}
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {adv.bank_account_name ? `${adv.bank_account_code ?? ""} ${adv.bank_account_name}`.trim() : "Payment account —"}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                              {fmt(adv.amount)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                              {fmt(adv.monthly_repayment)}/mo
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-blue-600 dark:text-blue-400">
                              {fmt(adv.repaid_amount ?? adv.repaid ?? 0)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums font-semibold">
                              <span className={outstanding === 0 ? "text-green-600 dark:text-green-400" : "text-orange-600 dark:text-orange-400"}>
                                {fmt(outstanding)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                              <div>{fmtDate(adv.date_issued)}</div>
                              {adv.cleared_at && (
                                <div className="text-green-600 dark:text-green-400">Cleared {fmtDate(adv.cleared_at.slice(0, 10))}</div>
                              )}
                              <button
                                type="button"
                                onClick={() => setExpandedAdvanceId((cur) => (cur === adv.id ? null : adv.id))}
                                className="mt-1 text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                {isExpanded ? "Hide repayments" : `View repayments (${repayments.length})`}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={6} className="px-5 py-3 bg-gray-50 dark:bg-gray-900/40">
                                {repayments.length === 0 ? (
                                  <p className="text-xs text-gray-500 dark:text-gray-400">No repayments yet.</p>
                                ) : (
                                  <div className="space-y-2">
                                    {repayments.map((repayment) => {
                                      const repaymentMeta = repaymentStatusMeta(repayment.status)
                                      const runLabel = repayment.payroll_run
                                        ? formatPayrollRunLabel(repayment.payroll_run)
                                        : null
                                      return (
                                        <div
                                          key={repayment.id}
                                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 bg-white dark:bg-gray-800"
                                        >
                                          <div className="text-xs text-gray-600 dark:text-gray-300">
                                            <div>
                                              Payroll: {runLabel ?? "—"}
                                            </div>
                                            <div>
                                              Posted: {repayment.posted_at ? fmtDate(repayment.posted_at.slice(0, 10)) : "—"}
                                            </div>
                                            {repayment.journal_entry_id && (
                                              <div className="text-gray-500 dark:text-gray-400">
                                                Journal: {repayment.journal_entry_id.slice(0, 8)}...
                                              </div>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-3">
                                            <span className="text-sm tabular-nums text-gray-900 dark:text-white">
                                              {fmt(Number(repayment.amount || 0))}
                                            </span>
                                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${repaymentMeta.cls}`}>
                                              {repaymentMeta.label}
                                            </span>
                                            {repayment.payroll_run_id && (
                                              <a
                                                href={`${payrollBase}/${repayment.payroll_run_id}`}
                                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                              >
                                                View run
                                              </a>
                                            )}
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
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

          {/* ── Issue Advance Form ── */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Issue Salary Advance</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Posts a journal entry: Dr Staff Advances (1110) / Cr Bank and creates a recurring monthly deduction.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Employee */}
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Employee <span className="text-red-500">*</span>
                  </label>
                  <select
                    name="staff_id"
                    value={form.staff_id}
                    onChange={handleChange}
                    required
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select employee…</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}{s.position ? ` — ${s.position}` : ""}
                      </option>
                    ))}
                  </select>
                  {staff.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1">No active staff found. Add staff in Settings → Staff.</p>
                  )}
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Advance Amount <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    name="amount"
                    value={form.amount}
                    onChange={handleChange}
                    min="0.01"
                    step="0.01"
                    required
                    placeholder="0.00"
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Monthly Repayment */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Monthly Repayment <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    name="monthly_repayment"
                    value={form.monthly_repayment}
                    onChange={handleChange}
                    min="0.01"
                    step="0.01"
                    required
                    placeholder="0.00"
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Deducted from each payroll run until the advance is recovered</p>
                </div>

                {/* Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Date Issued <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    name="date_issued"
                    value={form.date_issued}
                    onChange={handleChange}
                    required
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Bank Account */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Paid From (Bank / Cash) <span className="text-red-500">*</span>
                  </label>
                  <select
                    name="bank_account_id"
                    value={form.bank_account_id}
                    onChange={handleChange}
                    required
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select account…</option>
                    {bankAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                    ))}
                  </select>
                </div>

                {/* Notes */}
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes (optional)</label>
                  <textarea
                    name="notes"
                    value={form.notes}
                    onChange={handleChange}
                    rows={2}
                    placeholder="e.g. Medical emergency advance"
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                  />
                </div>
              </div>

              {/* DR/CR Preview */}
              {amountNum > 0 && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30 p-4">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Journal Entry Preview</p>
                  <div className="space-y-1 text-sm font-mono">
                    <div className="flex justify-between">
                      <span className="text-gray-700 dark:text-gray-300">Dr  Staff Advances (1110)</span>
                      <span className="text-gray-900 dark:text-white">{fmt(amountNum)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-700 dark:text-gray-300">
                        Cr  {selectedBank ? `${selectedBank.name} (${selectedBank.code})` : "Bank / Cash"}
                      </span>
                      <span className="text-gray-900 dark:text-white">{fmt(amountNum)}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? (
                    <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Issuing…</>
                  ) : (
                    "Issue Advance"
                  )}
                </button>
              </div>
            </form>
          </div>

        </div>
      </div>
  )
}
