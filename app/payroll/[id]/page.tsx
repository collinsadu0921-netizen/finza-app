"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter, useParams } from "next/navigation"
import { useToast } from "@/components/ui/ToastProvider"
import { usePayrollBasePath } from "@/lib/payrollBasePathContext"

type PayrollEntry = {
  id: string
  basic_salary: number
  allowances_total: number
  regular_allowances_amount?: number
  bonus_amount?: number
  overtime_amount?: number
  deductions_total: number
  gross_salary: number
  ssnit_employee: number
  ssnit_employer: number
  taxable_income: number
  paye: number
  net_salary: number
  staff: {
    id: string
    name: string
    position: string | null
    phone: string | null
    whatsapp_phone: string | null
    email: string | null
  }
}

type PayrollRun = {
  id: string
  payroll_month: string
  status: string
  total_gross_salary: number
  total_allowances: number
  total_deductions: number
  total_ssnit_employee: number
  total_ssnit_employer: number
  total_paye: number
  total_net_salary: number
  notes: string | null
}

type Payslip = {
  id: string
  staff_id: string
  public_token: string | null
  sent_via_whatsapp: boolean
  sent_via_email: boolean
  sent_at: string | null
  whatsapp_sent_at: string | null
  email_sent_at: string | null
}

type PayrollPayment = {
  id: string
  payroll_run_id: string
  payment_date: string
  amount: number
  payment_account_id: string
  reference: string | null
  notes: string | null
  journal_entry_id: string | null
  created_at: string
  payment_account?: {
    id: string
    name: string
    code: string
    sub_type: string | null
    type: string
  } | null
}

type PayrollPaymentSummary = {
  total_net_salary: number
  paid_amount: number
  outstanding_amount: number
  payment_status: "unpaid" | "partially_paid" | "paid"
  latest_payment_date: string | null
}

type PaymentAccount = {
  id: string
  name: string
  code: string
  sub_type: string | null
  type: string
}

type SendModalState = {
  payslipId: string
  staffName: string
  staffEmail: string | null
  staffPhone: string | null
} | null

export default function PayrollRunViewPage() {
  const router = useRouter()
  const payrollBase = usePayrollBasePath()
  const params = useParams()
  const runId = params.id as string
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [payrollRun, setPayrollRun] = useState<PayrollRun | null>(null)
  const [entries, setEntries] = useState<PayrollEntry[]>([])
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [updating, setUpdating] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [sendingAll, setSendingAll] = useState(false)
  const [recordingPayment, setRecordingPayment] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [salaryPayments, setSalaryPayments] = useState<PayrollPayment[]>([])
  const [paymentSummary, setPaymentSummary] = useState<PayrollPaymentSummary | null>(null)
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([])
  const [paymentError, setPaymentError] = useState("")
  const [paymentForm, setPaymentForm] = useState({
    payment_date: new Date().toISOString().split("T")[0],
    amount: "",
    payment_account_id: "",
    reference: "",
    notes: "",
  })

  // Send modal state
  const [sendModal, setSendModal] = useState<SendModalState>(null)
  const [sendEmail, setSendEmailInput] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState("")

  const loadPayrollRun = useCallback(async () => {
    try {
      const response = await fetch(`/api/payroll/runs/${runId}`)
      const data = await response.json()
      if (response.ok) {
        setPayrollRun(data.payrollRun)
        setEntries(data.entries || [])
        if (data.paymentSummary) setPaymentSummary(data.paymentSummary)
        if (Array.isArray(data.payments)) setSalaryPayments(data.payments)
      }
    } catch (err) {
      console.error("Error loading payroll run:", err)
    } finally {
      setLoading(false)
    }
  }, [runId])

  const loadPayslips = useCallback(async () => {
    try {
      const response = await fetch(`/api/payroll/runs/${runId}/payslips`)
      if (response.ok) {
        const data = await response.json()
        setPayslips(data.payslips || [])
      }
    } catch (_) {}
  }, [runId])

  const loadPayrollPayments = useCallback(async () => {
    try {
      const response = await fetch(`/api/payroll/runs/${runId}/payments`)
      const data = await response.json()
      if (response.ok) {
        setSalaryPayments(data.payments || [])
        setPaymentSummary(data.summary || null)
        setPaymentAccounts(data.paymentAccounts || [])
      }
    } catch (err) {
      console.error("Error loading payroll payments:", err)
    }
  }, [runId])

  useEffect(() => {
    loadPayrollRun()
    loadPayslips()
    loadPayrollPayments()
  }, [loadPayrollRun, loadPayslips, loadPayrollPayments])

  const handleApprove = async () => {
    setUpdating(true)
    try {
      const response = await fetch(`/api/payroll/runs/${runId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      })
      const data = await response.json()
      if (response.ok) {
        loadPayrollRun()
        toast.showToast("Payroll approved", "success")
      } else {
        toast.showToast(data.error || "Error approving payroll run", "error")
      }
    } catch {
      toast.showToast("Error approving payroll run", "error")
    } finally {
      setUpdating(false)
    }
  }

  const handleGeneratePayslips = async () => {
    setGenerating(true)
    try {
      const response = await fetch(`/api/payroll/runs/${runId}/generate-payslips`, {
        method: "POST",
      })
      const data = await response.json()
      if (response.ok) {
        toast.showToast(`${data.payslips?.length ?? 0} payslips generated`, "success")
        await loadPayslips()
      } else {
        toast.showToast(data.error || "Error generating payslips", "error")
      }
    } catch {
      toast.showToast("Error generating payslips", "error")
    } finally {
      setGenerating(false)
    }
  }

  const handleSendWhatsApp = async (payslipId: string) => {
    setSending(true)
    setSendError("")
    try {
      const res = await fetch(`/api/payroll/payslips/${payslipId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendWhatsApp: true }),
      })
      const data = await res.json()
      if (!res.ok) { setSendError(data.error || "Failed to send"); return }
      if (data.whatsappUrl) {
        window.open(data.whatsappUrl, "_blank", "noopener,noreferrer")
      }
      toast.showToast("WhatsApp opened — send the message to deliver the payslip", "success")
      setSendModal(null)
      await loadPayslips()
    } catch {
      setSendError("Failed to send. Please try again.")
    } finally {
      setSending(false)
    }
  }

  const handleSendEmail = async (payslipId: string) => {
    setSending(true)
    setSendError("")
    try {
      const res = await fetch(`/api/payroll/payslips/${payslipId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendEmail: true, email: sendEmail || sendModal?.staffEmail }),
      })
      const data = await res.json()
      if (!res.ok) { setSendError(data.error || "Failed to send"); return }
      toast.showToast("Payslip emailed successfully", "success")
      setSendModal(null)
      setSendEmailInput("")
      await loadPayslips()
    } catch {
      setSendError("Failed to send. Please try again.")
    } finally {
      setSending(false)
    }
  }

  const handleSendAll = async () => {
    setSendingAll(true)
    try {
      const res = await fetch(`/api/payroll/runs/${runId}/send-all`, { method: "POST" })
      const data = await res.json()
      if (res.ok) {
        const msg = `Sent to ${data.sent} employee${data.sent !== 1 ? "s" : ""}${data.skipped > 0 ? ` (${data.skipped} skipped)` : ""}`
        toast.showToast(msg, "success")
        await loadPayslips()
      } else {
        toast.showToast(data.error || "Failed to send payslips", "error")
      }
    } catch {
      toast.showToast("Failed to send payslips", "error")
    } finally {
      setSendingAll(false)
    }
  }

  const openPaymentModal = () => {
    const outstanding = Number(paymentSummary?.outstanding_amount || 0)
    const defaultAccountId = paymentAccounts[0]?.id || ""
    setPaymentError("")
    setPaymentForm({
      payment_date: new Date().toISOString().split("T")[0],
      amount: outstanding > 0 ? outstanding.toFixed(2) : "",
      payment_account_id: defaultAccountId,
      reference: "",
      notes: "",
    })
    setShowPaymentModal(true)
  }

  const handleRecordSalaryPayment = async () => {
    if (!paymentForm.payment_date) {
      setPaymentError("Payment date is required.")
      return
    }
    if (!paymentForm.payment_account_id) {
      setPaymentError("Select a payment account.")
      return
    }
    const amount = Number(paymentForm.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentError("Amount must be a positive number.")
      return
    }

    setRecordingPayment(true)
    setPaymentError("")
    try {
      const res = await fetch(`/api/payroll/runs/${runId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_date: paymentForm.payment_date,
          amount,
          payment_account_id: paymentForm.payment_account_id,
          reference: paymentForm.reference || null,
          notes: paymentForm.notes || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPaymentError(data.error || "Failed to record salary payment.")
        return
      }
      setShowPaymentModal(false)
      toast.showToast("Salary payment recorded and posted to ledger", "success")
      await loadPayrollPayments()
    } catch {
      setPaymentError("Failed to record salary payment. Please try again.")
    } finally {
      setRecordingPayment(false)
    }
  }

  const openSendModal = (entry: PayrollEntry, payslip: Payslip) => {
    setSendError("")
    setSendEmailInput(entry.staff.email || "")
    setSendModal({
      payslipId: payslip.id,
      staffName: entry.staff.name,
      staffEmail: entry.staff.email,
      staffPhone: entry.staff.whatsapp_phone || entry.staff.phone,
    })
  }

  // Map payslips by staff_id for quick lookup
  const payslipByStaff: Record<string, Payslip> = {}
  for (const ps of payslips) {
    payslipByStaff[ps.staff_id] = ps
  }
  const hasPayslips = payslips.length > 0
  const paymentStatus = paymentSummary?.payment_status || "unpaid"
  const isRunPayable = payrollRun?.status === "approved" || payrollRun?.status === "locked"
  const outstandingAmount = Number(paymentSummary?.outstanding_amount || 0)
  const canRecordPayment = isRunPayable && outstandingAmount > 0.01
  const totals = entries.reduce(
    (acc, entry) => {
      acc.bonus += Number(entry.bonus_amount ?? 0)
      acc.overtime += Number(entry.overtime_amount ?? 0)
      return acc
    },
    { bonus: 0, overtime: 0 }
  )

  const formatMonth = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("en-GH", { month: "long", year: "numeric" })

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-500">Loading payroll run…</p>
      </div>
    )
  }

  if (!payrollRun) {
    return (
      <div className="p-6 text-center text-gray-500">Payroll run not found.</div>
    )
  }

  return (
    <>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-7xl mx-auto space-y-6">

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
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatMonth(payrollRun.payroll_month)}
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  payrollRun.status === "approved"
                    ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400"
                    : payrollRun.status === "locked"
                    ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400"
                    : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400"
                }`}>
                  {payrollRun.status.charAt(0).toUpperCase() + payrollRun.status.slice(1)}
                </span>
                {hasPayslips && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {payslips.length} payslip{payslips.length !== 1 ? "s" : ""} generated
                  </span>
                )}
                {paymentSummary && (
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      paymentStatus === "paid"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-400"
                        : paymentStatus === "partially_paid"
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400"
                        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    }`}
                  >
                    {paymentStatus === "paid"
                      ? "Payroll Paid"
                      : paymentStatus === "partially_paid"
                      ? "Partially Paid"
                      : "Unpaid"}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3 w-full sm:w-auto sm:items-end">
              {payrollRun.status === "draft" && (
                <p className="text-sm text-amber-800 dark:text-amber-200/90 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 max-w-xl text-left">
                  Approving payroll posts salary expense and payroll liabilities to accounting. It does not mark salaries as paid.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
              {payrollRun.status === "draft" && (
                <button
                  onClick={handleApprove}
                  disabled={updating}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {updating ? "Approving…" : "Approve Payroll"}
                </button>
              )}
              <button
                onClick={handleGeneratePayslips}
                disabled={generating || payrollRun.status === "draft"}
                title={payrollRun.status === "draft" ? "Approve payroll first before generating payslips" : undefined}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Generating…</>
                ) : (
                  <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  {hasPayslips ? "Regenerate Payslips" : "Generate Payslips"}</>
                )}
              </button>
              {hasPayslips && (
                <button
                  onClick={handleSendAll}
                  disabled={sendingAll}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {sendingAll ? (
                    <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Sending…</>
                  ) : (
                    <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                    Send All Payslips</>
                  )}
                </button>
              )}
              {isRunPayable && (
                <button
                  onClick={openPaymentModal}
                  disabled={!canRecordPayment}
                  title={!canRecordPayment ? "Payroll net salary is fully paid." : undefined}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-slate-700 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a5 5 0 00-10 0v2M5 9h14l-1 11H6L5 9z" />
                  </svg>
                  Record Salary Payment
                </button>
              )}
              </div>
            </div>
          </div>

          {/* Summary Cards — SSNIT split: only employee share reduces net pay; employer is a company cost */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-7">
            {[
              { label: "Gross Salary", value: payrollRun.total_gross_salary, color: "text-gray-900 dark:text-white" },
              { label: "Bonus", value: totals.bonus, color: "text-violet-600 dark:text-violet-400" },
              { label: "Overtime", value: totals.overtime, color: "text-indigo-600 dark:text-indigo-400" },
              { label: "PAYE", value: payrollRun.total_paye, color: "text-red-600 dark:text-red-400" },
              {
                label: "SSNIT (employee)",
                value: payrollRun.total_ssnit_employee || 0,
                color: "text-orange-600 dark:text-orange-400",
              },
              {
                label: "SSNIT (employer)",
                value: payrollRun.total_ssnit_employer || 0,
                color: "text-amber-700 dark:text-amber-500",
              },
              { label: "Net Salary", value: payrollRun.total_net_salary, color: "text-green-600 dark:text-green-400" },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-5"
              >
                <p className="mb-1 text-[11px] font-medium leading-snug text-gray-500 dark:text-gray-400 sm:text-xs">
                  {label}
                </p>
                <p
                  className={`min-w-0 text-xs font-bold tabular-nums leading-none tracking-tight whitespace-nowrap sm:text-sm lg:text-sm xl:text-base ${color}`}
                >
                  ₵{Number(value || 0).toFixed(2)}
                </p>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1 mb-2">
            Net salary is gross minus PAYE, employee SSNIT, and other employee deductions — not employer SSNIT.
          </p>

          {paymentSummary && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Salary Payment Summary</h2>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {paymentSummary.latest_payment_date
                    ? `Last payment: ${new Date(paymentSummary.latest_payment_date).toLocaleDateString("en-GH")}`
                    : "No salary payment recorded"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div className="min-w-0">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Payment Status</p>
                  <p className="text-sm font-semibold leading-tight text-gray-900 dark:text-white sm:text-base">
                    {paymentStatus === "paid"
                      ? "Paid"
                      : paymentStatus === "partially_paid"
                      ? "Partially Paid"
                      : "Unpaid"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Net Salary Payable</p>
                  <p className="text-sm font-semibold tabular-nums leading-none tracking-tight text-gray-900 whitespace-nowrap dark:text-white sm:text-sm md:text-base">
                    ₵{Number(paymentSummary.total_net_salary || 0).toFixed(2)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Paid Amount</p>
                  <p className="text-sm font-semibold tabular-nums leading-none tracking-tight text-emerald-600 whitespace-nowrap dark:text-emerald-400 sm:text-sm md:text-base">
                    ₵{Number(paymentSummary.paid_amount || 0).toFixed(2)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Outstanding Amount</p>
                  <p className="text-sm font-semibold tabular-nums leading-none tracking-tight text-amber-600 whitespace-nowrap dark:text-amber-400 sm:text-sm md:text-base">
                    ₵{Number(paymentSummary.outstanding_amount || 0).toFixed(2)}
                  </p>
                </div>
              </div>

              {salaryPayments.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        <th className="py-2">Date</th>
                        <th className="py-2">Account</th>
                        <th className="py-2">Reference</th>
                        <th className="py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {salaryPayments.map((payment) => (
                        <tr key={payment.id}>
                          <td className="py-2 text-gray-700 dark:text-gray-300">
                            {new Date(payment.payment_date).toLocaleDateString("en-GH")}
                          </td>
                          <td className="py-2 text-gray-700 dark:text-gray-300">
                            {payment.payment_account?.code} - {payment.payment_account?.name}
                          </td>
                          <td className="py-2 text-gray-500 dark:text-gray-400">{payment.reference || "—"}</td>
                          <td className="py-2 text-right font-medium text-gray-900 dark:text-white">
                            ₵{Number(payment.amount || 0).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Payslips hint when not generated */}
          {!hasPayslips && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-4 flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-blue-800 dark:text-blue-300">
                Click <strong>Generate Payslips</strong> to create shareable payslips for each employee, then send them via WhatsApp or email.
              </p>
            </div>
          )}

          {/* Payroll Entries Table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Employee Breakdown</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Employee</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Basic</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Allowances</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Bonus</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Overtime</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Gross</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">SSNIT (emp.)</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">PAYE</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Net</th>
                    <th className="px-5 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Payslip</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {entries.map((entry) => {
                    const payslip = payslipByStaff[entry.staff.id]
                    const sentViaWA = payslip?.sent_via_whatsapp
                    const sentViaEmail = payslip?.sent_via_email
                    const anySent = sentViaWA || sentViaEmail

                    return (
                      <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                        <td className="px-5 py-4">
                          <p className="font-medium text-gray-900 dark:text-white">{entry.staff.name}</p>
                          {entry.staff.position && <p className="text-xs text-gray-500">{entry.staff.position}</p>}
                        </td>
                        <td className="px-4 py-4 text-right text-gray-700 dark:text-gray-300 tabular-nums">₵{Number(entry.basic_salary).toFixed(2)}</td>
                        <td className="px-4 py-4 text-right text-gray-700 dark:text-gray-300 tabular-nums">₵{Number(entry.allowances_total).toFixed(2)}</td>
                        <td className="px-4 py-4 text-right text-violet-600 dark:text-violet-400 tabular-nums">₵{Number(entry.bonus_amount ?? 0).toFixed(2)}</td>
                        <td className="px-4 py-4 text-right text-indigo-600 dark:text-indigo-400 tabular-nums">₵{Number(entry.overtime_amount ?? 0).toFixed(2)}</td>
                        <td className="px-4 py-4 text-right font-medium text-gray-900 dark:text-white tabular-nums">₵{Number(entry.gross_salary).toFixed(2)}</td>
                        <td className="px-4 py-4 text-right text-orange-600 dark:text-orange-400 tabular-nums">₵{Number(entry.ssnit_employee).toFixed(2)}</td>
                        <td className="px-4 py-4 text-right text-red-600 dark:text-red-400 tabular-nums">₵{Number(entry.paye).toFixed(2)}</td>
                        <td className="px-4 py-4 text-right font-bold text-green-600 dark:text-green-400 tabular-nums">₵{Number(entry.net_salary).toFixed(2)}</td>
                        <td className="px-5 py-4 text-center">
                          {payslip ? (
                            <div className="flex flex-col items-center gap-1.5">
                              {/* Status badges */}
                              <div className="flex gap-1">
                                {sentViaWA && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 text-xs rounded font-medium">
                                    <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M11.95 1c-5.923 0-10.73 4.807-10.73 10.73 0 1.87.483 3.627 1.325 5.157L1 23l6.307-1.654A10.69 10.69 0 0011.95 22.46c5.923 0 10.73-4.807 10.73-10.73S17.873 1 11.95 1zm0 19.636a8.89 8.89 0 01-4.529-1.24l-.324-.193-3.745.982.999-3.65-.211-.343A8.88 8.88 0 013.073 11.73c0-4.896 3.981-8.877 8.877-8.877 4.896 0 8.877 3.981 8.877 8.877 0 4.896-3.981 8.877-8.877 8.877z"/></svg>
                                    WA
                                  </span>
                                )}
                                {sentViaEmail && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 text-xs rounded font-medium">
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                                    Email
                                  </span>
                                )}
                              </div>
                              {/* Actions */}
                              <div className="flex gap-1">
                                <button
                                  onClick={() => openSendModal(entry, payslip)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                                  {anySent ? "Send again" : "Send"}
                                </button>
                                {payslip.public_token && (
                                  <a
                                    href={`/payslips/${encodeURIComponent(payslip.public_token)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                    View
                                  </a>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400 dark:text-gray-500">Not generated</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>

      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-white">Record Salary Payment</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  This records salary disbursement and posts Dr Net Salaries Payable, Cr selected payment account. It does not change payroll calculations or statutory liabilities.
                </p>
              </div>
              <button
                onClick={() => {
                  if (!recordingPayment) {
                    setShowPaymentModal(false)
                    setPaymentError("")
                  }
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {paymentError && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {paymentError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="space-y-1">
                  <span className="text-sm text-gray-700 dark:text-gray-300">Payment Date</span>
                  <input
                    type="date"
                    value={paymentForm.payment_date}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, payment_date: e.target.value }))}
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sm text-gray-700 dark:text-gray-300">Amount</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white"
                  />
                </label>
              </div>

              <label className="space-y-1 block">
                <span className="text-sm text-gray-700 dark:text-gray-300">Payment Account</span>
                <select
                  value={paymentForm.payment_account_id}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, payment_account_id: e.target.value }))}
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white"
                >
                  <option value="">Select account</option>
                  {paymentAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} - {account.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 block">
                <span className="text-sm text-gray-700 dark:text-gray-300">Reference (optional)</span>
                <input
                  type="text"
                  value={paymentForm.reference}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, reference: e.target.value }))}
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white"
                  placeholder="Bank transfer ref / cheque no"
                />
              </label>

              <label className="space-y-1 block">
                <span className="text-sm text-gray-700 dark:text-gray-300">Notes (optional)</span>
                <textarea
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white"
                  rows={3}
                />
              </label>

              <div className="text-xs text-gray-500 dark:text-gray-400">
                Outstanding net salary payable: ₵{Number(paymentSummary?.outstanding_amount || 0).toFixed(2)}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button
                onClick={() => setShowPaymentModal(false)}
                disabled={recordingPayment}
                className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleRecordSalaryPayment}
                disabled={recordingPayment}
                className="px-4 py-2 rounded-lg text-sm bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {recordingPayment ? "Posting..." : "Record Payment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Send Payslip Modal ── */}
      {sendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-white">Send Payslip</h2>
                <p className="text-xs text-gray-500 mt-0.5">{sendModal.staffName}</p>
              </div>
              <button
                onClick={() => { setSendModal(null); setSendError("") }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Modal body */}
            <div className="px-6 py-5 space-y-4">
              {sendError && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {sendError}
                </div>
              )}

              {/* WhatsApp */}
              <div className="border border-gray-200 dark:border-gray-600 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-green-600" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M11.95 1c-5.923 0-10.73 4.807-10.73 10.73 0 1.87.483 3.627 1.325 5.157L1 23l6.307-1.654A10.69 10.69 0 0011.95 22.46c5.923 0 10.73-4.807 10.73-10.73S17.873 1 11.95 1zm0 19.636a8.89 8.89 0 01-4.529-1.24l-.324-.193-3.745.982.999-3.65-.211-.343A8.88 8.88 0 013.073 11.73c0-4.896 3.981-8.877 8.877-8.877 4.896 0 8.877 3.981 8.877 8.877 0 4.896-3.981 8.877-8.877 8.877z"/></svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800 dark:text-white">Send via WhatsApp</p>
                    <p className="text-xs text-gray-500">{sendModal.staffPhone || "No phone number on file"}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleSendWhatsApp(sendModal.payslipId)}
                  disabled={sending || !sendModal.staffPhone}
                  className="w-full py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending ? "Opening…" : "Open WhatsApp"}
                </button>
                {!sendModal.staffPhone && (
                  <p className="text-xs text-amber-600">Add a phone number to this staff member's profile to send via WhatsApp.</p>
                )}
              </div>

              {/* Email */}
              <div className="border border-gray-200 dark:border-gray-600 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800 dark:text-white">Send via Email</p>
                    <p className="text-xs text-gray-500">Enter or confirm staff email</p>
                  </div>
                </div>
                <input
                  type="email"
                  value={sendEmail}
                  onChange={(e) => setSendEmailInput(e.target.value)}
                  placeholder="staff@example.com"
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                />
                <button
                  onClick={() => handleSendEmail(sendModal.payslipId)}
                  disabled={sending || (!sendEmail && !sendModal.staffEmail)}
                  className="w-full py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending ? "Sending…" : "Send Email"}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}
    </>
  )
}
