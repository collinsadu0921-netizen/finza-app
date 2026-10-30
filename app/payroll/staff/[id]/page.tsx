"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { useToast } from "@/components/ui/ToastProvider"
import { useConfirm } from "@/components/ui/ConfirmProvider"
import { ALLOWANCE_TYPE_OPTIONS, DEDUCTION_TYPE_OPTIONS } from "@/lib/payrollTypes"
import { formatEmploymentTypeLabel } from "@/lib/payroll/ghanaIncomeTaxDisplay"
import { usePayrollBasePath } from "@/lib/payrollBasePathContext"
import {
  maskAccountNumber,
  maskMomoNumber,
  normalizeGhanaMomoProvider,
} from "@/lib/payroll/paymentDestinationInput"
import {
  validateStaffPaymentMethodFields,
  type StaffPaymentMethodFieldErrors,
} from "@/lib/staffPaymentMethods"

type Staff = {
  id: string
  name: string
  position: string | null
  phone: string | null
  whatsapp_phone: string | null
  email: string | null
  basic_salary: number
  salary_basis?: string | null
  employment_type: string
  bank_name: string | null
  bank_account: string | null
  ssnit_number: string | null
  tin_number: string | null
  start_date: string
  status: string
  is_tax_resident?: boolean
  is_pensionable?: boolean
  gra_position_code?: string | null
  secondary_employment?: boolean
}

type Allowance = {
  id: string
  type: string
  amount: number
  recurring: boolean
  description: string | null
}

type Deduction = {
  id: string
  type: string
  amount: number
  recurring: boolean
  description: string | null
}

type SalaryHistoryPayment = {
  id: string
  amount: number
  payment_date: string | null
  reference: string | null
  payment_method?: string | null
  payment_account_code?: string | null
}

type SalaryHistoryRow = {
  payroll_run_id: string
  payroll_entry_id: string
  payroll_month: string
  pay_period_start: string | null
  pay_period_end: string | null
  payroll_frequency: string
  run_type: string
  run_status: string
  is_reversed_run: boolean
  basic_salary: number
  allowances_total: number
  deductions_total: number
  gross_salary: number
  paye: number
  ssnit_employee: number
  ssnit_employer: number
  net_salary: number
  payment_status: "paid" | "partially_paid" | "unpaid" | "unverified"
  payment_status_label: string
  confirmed_paid_amount: number
  outstanding_amount: number | null
  unverified_amount: number
  has_unallocated_aggregate_payment: boolean
  payments: SalaryHistoryPayment[]
  aggregate_payments: SalaryHistoryPayment[]
  payslip: {
    id: string
    public_token: string | null
    created_at: string | null
  } | null
}

type SalaryHistoryResponse = {
  staff: {
    id: string
    name: string
    basic_salary: number
    salary_basis: string
    employment_type: string
    start_date: string
    status: string
  }
  summary: {
    total_net_salary: number
    total_confirmed_paid: number
    total_outstanding: number
    total_unverified: number
    total_reversed_net_salary: number
    period_count: number
    unallocated_aggregate_payment_total: number
  }
  history: SalaryHistoryRow[]
  available_years: number[]
  pagination: {
    limit: number
    offset: number
    has_more: boolean
  }
}

type StaffPaymentMethod = {
  id: string
  method_type: string
  provider_name: string | null
  bank_name: string | null
  bank_code: string | null
  branch_name: string | null
  account_number: string | null
  account_name: string | null
  momo_provider: string | null
  momo_number: string | null
  is_default: boolean
  is_verified: boolean
  verification_status: string
  paystack_recipient_code?: string | null
  paystack_recipient_environment?: string | null
  paystack_recipient_fingerprint?: string | null
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bank: "Bank transfer",
  momo: "Mobile money",
  cash: "Cash",
}

function verificationLabel(status: string): string {
  const value = String(status || "").toLowerCase()
  if (value === "verified") return "Verified"
  if (value === "unverified") return "Not verified yet"
  return value.replace(/_/g, " ")
}

function emptyPaymentMethodForm() {
  return {
    method_type: "bank" as "bank" | "momo" | "cash",
    provider_name: "",
    bank_name: "",
    bank_code: "",
    branch_name: "",
    account_number: "",
    account_name: "",
    momo_provider: "",
    momo_number: "",
    is_default: false,
  }
}

function MiniBadge({
  label,
  tone = "neutral",
}: {
  label: string
  tone?: "neutral" | "blue"
}) {
  const tones = {
    neutral: "bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100",
    blue: "bg-blue-100 dark:bg-blue-900/50 text-blue-900 dark:text-blue-200",
  } as const
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full mr-1 mb-1 inline-block ${tones[tone]}`}>
      {label}
    </span>
  )
}

function salaryPeriodLabel(row: SalaryHistoryRow): string {
  const raw = row.payroll_month || row.pay_period_start
  if (!raw) return "Payroll period"
  const d = new Date(`${String(raw).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 10)
  return d.toLocaleDateString("en-GH", { month: "short", year: "numeric" })
}

function paymentStatusClasses(status: SalaryHistoryRow["payment_status"]): string {
  switch (status) {
    case "paid":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
    case "partially_paid":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
    case "unverified":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
    default:
      return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
  }
}

function SalaryHistoryMobileCard({
  row,
  payrollBase,
}: {
  row: SalaryHistoryRow
  payrollBase: string
}) {
  const aggregateTotal = row.aggregate_payments.reduce(
    (sum, payment) => sum + Number(payment.amount || 0),
    0
  )
  const payslipToken = row.payslip?.public_token || null

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-900 dark:text-white">{salaryPeriodLabel(row)}</p>
          {row.is_reversed_run && (
            <span className="mt-1 inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
              Reversed payroll
            </span>
          )}
        </div>
        <span
          className={`inline-flex max-w-[190px] rounded-full px-2 py-0.5 text-[11px] font-medium ${paymentStatusClasses(
            row.payment_status
          )}`}
        >
          {row.payment_status_label}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-gray-500 dark:text-gray-400">Gross</p>
          <p className="font-medium text-gray-900 dark:text-white">GHS {Number(row.gross_salary || 0).toFixed(2)}</p>
        </div>
        <div>
          <p className="text-gray-500 dark:text-gray-400">Net salary</p>
          <p className="font-semibold text-gray-900 dark:text-white">GHS {Number(row.net_salary || 0).toFixed(2)}</p>
        </div>
        <div>
          <p className="text-gray-500 dark:text-gray-400">PAYE</p>
          <p className="font-medium text-gray-900 dark:text-white">GHS {Number(row.paye || 0).toFixed(2)}</p>
        </div>
        <div>
          <p className="text-gray-500 dark:text-gray-400">SSNIT</p>
          <p className="font-medium text-gray-900 dark:text-white">GHS {Number(row.ssnit_employee || 0).toFixed(2)}</p>
        </div>
        <div>
          <p className="text-gray-500 dark:text-gray-400">Outstanding</p>
          <p className="font-medium text-gray-900 dark:text-white">
            {row.outstanding_amount == null
              ? "Not verified"
              : `GHS ${Number(row.outstanding_amount || 0).toFixed(2)}`}
          </p>
        </div>
        <div>
          <p className="text-gray-500 dark:text-gray-400">Payslip</p>
          {payslipToken ? (
            <a
              href={`/payslips/${encodeURIComponent(payslipToken)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              View / print
            </a>
          ) : (
            <p className="text-gray-500 dark:text-gray-400">Not generated</p>
          )}
        </div>
      </div>

      {row.payments.length > 0 && (
        <div className="text-xs text-gray-600 dark:text-gray-300">
          {row.payments.map((payment) => (
            <p key={payment.id}>
              Paid GHS {Number(payment.amount || 0).toFixed(2)}
              {payment.payment_date
                ? ` on ${new Date(payment.payment_date).toLocaleDateString("en-GH")}`
                : ""}
              {payment.reference ? ` · ${payment.reference}` : ""}
              {payment.payment_method ? ` · ${payment.payment_method}` : ""}
            </p>
          ))}
        </div>
      )}

      {aggregateTotal > 0 && (
        <p className="text-xs text-blue-700 dark:text-blue-300">
          Unallocated aggregate: GHS {aggregateTotal.toFixed(2)} ({row.aggregate_payments.length})
        </p>
      )}
      {row.unverified_amount > 0 && (
        <p className="text-xs text-blue-700 dark:text-blue-300">
          GHS {Number(row.unverified_amount).toFixed(2)} not individually verified
        </p>
      )}

      <a
        href={`${payrollBase}/${row.payroll_run_id}`}
        className="inline-block text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
      >
        Open payroll run
      </a>
    </div>
  )
}

export default function StaffViewPage() {
  const router = useRouter()
  const payrollBase = usePayrollBasePath()
  const settingsStaffPath = payrollBase.startsWith("/service") ? "/service/settings/staff" : "/settings/staff"
  const params = useParams()
  const staffId = params.id as string
  const toast = useToast()
  const { openConfirm } = useConfirm()

  const [loading, setLoading] = useState(true)
  const [staff, setStaff] = useState<Staff | null>(null)
  const [allowances, setAllowances] = useState<Allowance[]>([])
  const [deductions, setDeductions] = useState<Deduction[]>([])
  const [paymentMethods, setPaymentMethods] = useState<StaffPaymentMethod[]>([])
  const [salaryHistory, setSalaryHistory] = useState<SalaryHistoryResponse | null>(null)
  const [salaryLoading, setSalaryLoading] = useState(true)
  const [salaryError, setSalaryError] = useState("")
  const [salaryPermissionDenied, setSalaryPermissionDenied] = useState(false)
  const [salaryYear, setSalaryYear] = useState("")
  const [salaryLimit, setSalaryLimit] = useState(24)
  const [error, setError] = useState("")
  const [showAllowanceModal, setShowAllowanceModal] = useState(false)
  const [showDeductionModal, setShowDeductionModal] = useState(false)
  const [showPaymentMethodModal, setShowPaymentMethodModal] = useState(false)
  const [editingAllowance, setEditingAllowance] = useState<Allowance | null>(null)
  const [editingDeduction, setEditingDeduction] = useState<Deduction | null>(null)
  const [editingPaymentMethod, setEditingPaymentMethod] = useState<StaffPaymentMethod | null>(null)

  const [allowanceForm, setAllowanceForm] = useState({
    type: "",
    amount: "",
    recurring: true,
    description: "",
  })

  const [deductionForm, setDeductionForm] = useState({
    type: "",
    amount: "",
    recurring: true,
    description: "",
  })

  const [paymentMethodForm, setPaymentMethodForm] = useState(emptyPaymentMethodForm())
  const [paymentMethodErrors, setPaymentMethodErrors] = useState<StaffPaymentMethodFieldErrors>({})
  const [paystackDestinations, setPaystackDestinations] = useState<{
    banks: Array<{ name: string; code: string }>
    mobile_money: Array<{ name: string; code: string; label: string }>
    environment: "test" | "live"
  } | null>(null)
  const [loadingPaystackDestinations, setLoadingPaystackDestinations] = useState(false)

  useEffect(() => {
    loadStaff()
  }, [staffId])

  useEffect(() => {
    if (!showPaymentMethodModal) return
    if (paymentMethodForm.method_type !== "bank" && paymentMethodForm.method_type !== "momo") return
    if (paystackDestinations || loadingPaystackDestinations) return
    let cancelled = false
    const loadDestinations = async () => {
      setLoadingPaystackDestinations(true)
      try {
        const response = await fetch("/api/payroll/paystack/banks", { cache: "no-store" })
        if (!response.ok) return
        const data = await response.json()
        if (!cancelled) {
          setPaystackDestinations({
            banks: data.banks || [],
            mobile_money: data.mobile_money || [],
            environment: data.environment === "live" ? "live" : "test",
          })
        }
      } catch {
        // Paystack not connected or not eligible: keep manual destination fields.
      } finally {
        if (!cancelled) setLoadingPaystackDestinations(false)
      }
    }
    void loadDestinations()
    return () => {
      cancelled = true
    }
  }, [showPaymentMethodModal, paymentMethodForm.method_type, paystackDestinations, loadingPaystackDestinations])

  useEffect(() => {
    loadSalaryHistory()
  }, [staffId, salaryYear, salaryLimit])

  const loadStaff = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/staff/${staffId}`)
      const data = await response.json()

      if (response.ok && data.staff) {
        setStaff(data.staff)
        setAllowances(data.allowances || [])
        setDeductions(data.deductions || [])
        setPaymentMethods(data.payment_methods || [])
      } else {
        setError(data.error || "Failed to load staff")
      }
    } catch (err: any) {
      setError(err.message || "Failed to load staff")
    } finally {
      setLoading(false)
    }
  }

  const loadSalaryHistory = async () => {
    try {
      setSalaryLoading(true)
      setSalaryError("")
      setSalaryPermissionDenied(false)
      const params = new URLSearchParams()
      params.set("limit", String(salaryLimit))
      if (salaryYear) params.set("year", salaryYear)
      const response = await fetch(`/api/staff/${staffId}/salary-history?${params.toString()}`)
      const data = await response.json()
      if (!response.ok) {
        if (response.status === 403) {
          setSalaryPermissionDenied(true)
          setSalaryHistory(null)
          return
        }
        setSalaryError(data.error || "Failed to load salary history")
        return
      }
      setSalaryHistory(data)
    } catch (err: any) {
      setSalaryError(err.message || "Failed to load salary history")
    } finally {
      setSalaryLoading(false)
    }
  }

  const handleSalaryYearChange = (year: string) => {
    setSalaryYear(year)
    setSalaryLimit(24)
  }

  const handleSaveAllowance = async () => {
    if (!allowanceForm.type || !allowanceForm.amount) {
      toast.showToast("Please fill in type and amount", "warning")
      return
    }

    try {
      const url = editingAllowance
        ? `/api/staff/${staffId}/allowances/${editingAllowance.id}`
        : `/api/staff/${staffId}/allowances`
      const method = editingAllowance ? "PUT" : "POST"

      const payload: Record<string, unknown> = {
        type: allowanceForm.type.trim(),
        amount: parseFloat(allowanceForm.amount),
        description: allowanceForm.description.trim() || null,
      }
      // Creates from staff page are recurring only. Edits leave recurring/run linkage unchanged.
      if (!editingAllowance) payload.recurring = true

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const data = await response.json()

      if (response.ok) {
        setShowAllowanceModal(false)
        setEditingAllowance(null)
        setAllowanceForm({ type: "", amount: "", recurring: true, description: "" })
        loadStaff()
      } else {
        toast.showToast(data.error || "Failed to save allowance", "error")
      }
    } catch (err: any) {
      toast.showToast(err.message || "Failed to save allowance", "error")
    }
  }

  const handleSaveDeduction = async () => {
    if (!deductionForm.type || !deductionForm.amount) {
      toast.showToast("Please fill in type and amount", "warning")
      return
    }

    try {
      const url = editingDeduction
        ? `/api/staff/${staffId}/deductions/${editingDeduction.id}`
        : `/api/staff/${staffId}/deductions`
      const method = editingDeduction ? "PUT" : "POST"

      const payload: Record<string, unknown> = {
        type: deductionForm.type.trim(),
        amount: parseFloat(deductionForm.amount),
        description: deductionForm.description.trim() || null,
      }
      if (!editingDeduction) payload.recurring = true

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const data = await response.json()

      if (response.ok) {
        setShowDeductionModal(false)
        setEditingDeduction(null)
        setDeductionForm({ type: "", amount: "", recurring: true, description: "" })
        loadStaff()
      } else {
        toast.showToast(data.error || "Failed to save deduction", "error")
      }
    } catch (err: any) {
      toast.showToast(err.message || "Failed to save deduction", "error")
    }
  }

  const handleDeleteAllowance = async (id: string) => {
    openConfirm({
      title: "Delete allowance",
      description: "Are you sure you want to delete this allowance?",
      onConfirm: () => runDeleteAllowance(id),
    })
  }

  const runDeleteAllowance = async (id: string) => {
    try {
      const response = await fetch(`/api/staff/${staffId}/allowances/${id}`, { method: "DELETE" })
      if (response.ok) loadStaff()
      else {
        const data = await response.json()
        toast.showToast(data.error || "Failed to delete allowance", "error")
      }
    } catch (err: any) {
      toast.showToast(err.message || "Failed to delete allowance", "error")
    }
  }

  const handleDeleteDeduction = async (id: string) => {
    openConfirm({
      title: "Delete deduction",
      description: "Are you sure you want to delete this deduction?",
      onConfirm: () => runDeleteDeduction(id),
    })
  }

  const runDeleteDeduction = async (id: string) => {
    try {
      const response = await fetch(`/api/staff/${staffId}/deductions/${id}`, { method: "DELETE" })
      if (response.ok) loadStaff()
      else {
        const data = await response.json()
        toast.showToast(data.error || "Failed to delete deduction", "error")
      }
    } catch (err: any) {
      toast.showToast(err.message || "Failed to delete deduction", "error")
    }
  }

  const openEditAllowance = (allowance: Allowance) => {
    setEditingAllowance(allowance)
    setAllowanceForm({
      type: allowance.type,
      amount: allowance.amount.toString(),
      recurring: allowance.recurring,
      description: allowance.description || "",
    })
    setShowAllowanceModal(true)
  }

  const openEditDeduction = (deduction: Deduction) => {
    setEditingDeduction(deduction)
    setDeductionForm({
      type: deduction.type,
      amount: deduction.amount.toString(),
      recurring: deduction.recurring,
      description: deduction.description || "",
    })
    setShowDeductionModal(true)
  }

  const clearPaymentMethodFieldError = (field: keyof StaffPaymentMethodFieldErrors) => {
    setPaymentMethodErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  const paymentMethodInputClass = (field: keyof StaffPaymentMethodFieldErrors) =>
    `w-full px-4 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white ${
      paymentMethodErrors[field]
        ? "border-red-500 focus:border-red-500"
        : "border-gray-300 dark:border-gray-600"
    }`

  const openAddPaymentMethod = () => {
    setEditingPaymentMethod(null)
    setPaymentMethodForm(emptyPaymentMethodForm())
    setPaymentMethodErrors({})
    setShowPaymentMethodModal(true)
  }

  const openEditPaymentMethod = (m: StaffPaymentMethod) => {
    setEditingPaymentMethod(m)
    const mtKnown =
      m.method_type === "bank" || m.method_type === "momo" || m.method_type === "cash"
        ? m.method_type
        : "bank"
    const momoProvider = m.momo_provider
      ? normalizeGhanaMomoProvider(m.momo_provider)?.code ?? m.momo_provider
      : ""
    setPaymentMethodForm({
      method_type: mtKnown,
      provider_name: m.provider_name || "",
      bank_name: m.bank_name || "",
      bank_code: m.bank_code || "",
      branch_name: m.branch_name || "",
      account_number: m.account_number || "",
      account_name: m.account_name || "",
      momo_provider: momoProvider,
      momo_number: m.momo_number || "",
      is_default: m.is_default,
    })
    setPaymentMethodErrors({})
    setShowPaymentMethodModal(true)
  }

  const handleSavePaymentMethod = async () => {
    try {
      const url = editingPaymentMethod
        ? `/api/staff/${staffId}/payment-methods/${editingPaymentMethod.id}`
        : `/api/staff/${staffId}/payment-methods`
      const method = editingPaymentMethod ? "PATCH" : "POST"
      const body: Record<string, unknown> = {
        method_type: paymentMethodForm.method_type,
        provider_name: paymentMethodForm.provider_name.trim() || null,
        is_default: paymentMethodForm.is_default,
      }
      const mt = paymentMethodForm.method_type
      if (mt === "bank") {
        body.bank_name = paymentMethodForm.bank_name.trim() || null
        body.bank_code = paymentMethodForm.bank_code.trim() || null
        body.branch_name = paymentMethodForm.branch_name.trim() || null
        body.account_number = paymentMethodForm.account_number.trim() || null
        body.account_name = paymentMethodForm.account_name.trim() || null
      } else if (mt === "momo") {
        body.momo_provider = paymentMethodForm.momo_provider.trim() || null
        body.momo_number = paymentMethodForm.momo_number.trim() || null
        body.account_name = paymentMethodForm.account_name.trim() || null
      }

      const validation = validateStaffPaymentMethodFields(
        body as Parameters<typeof validateStaffPaymentMethodFields>[0]
      )
      if (!validation.ok) {
        setPaymentMethodErrors(validation.errors)
        toast.showToast("Check the highlighted payment details.", "error")
        return
      }
      setPaymentMethodErrors({})

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await response.json()

      if (response.ok) {
        setShowPaymentMethodModal(false)
        setEditingPaymentMethod(null)
        setPaymentMethodForm(emptyPaymentMethodForm())
        loadStaff()
      } else {
        toast.showToast(data.error || "Failed to save payment method", "error")
      }
    } catch (err: any) {
      toast.showToast(err.message || "Failed to save payment method", "error")
    }
  }

  const runSetDefaultPaymentMethod = async (id: string) => {
    try {
      const response = await fetch(`/api/staff/${staffId}/payment-methods/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_default: true }),
      })
      const data = await response.json()
      if (response.ok) loadStaff()
      else toast.showToast(data.error || "Failed to set default", "error")
    } catch (err: any) {
      toast.showToast(err.message || "Failed to set default", "error")
    }
  }

  const handleDeletePaymentMethod = (id: string) => {
    openConfirm({
      title: "Remove payment method",
      description: "This only removes the saved destination; it does not send money or change payroll history.",
      onConfirm: () => runDeletePaymentMethod(id),
    })
  }

  const runDeletePaymentMethod = async (id: string) => {
    try {
      const response = await fetch(`/api/staff/${staffId}/payment-methods/${id}`, { method: "DELETE" })
      if (response.ok) loadStaff()
      else {
        const data = await response.json()
        toast.showToast(data.error || "Failed to remove payment method", "error")
      }
    } catch (err: any) {
      toast.showToast(err.message || "Failed to remove payment method", "error")
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <p>Loading...</p>
      </div>
    )
  }

  if (!staff) {
    return (
      <div className="p-6">
        <p className="text-red-500">{error || "Staff not found"}</p>
        <button onClick={() => router.push(settingsStaffPath)} className="mt-4 text-blue-600 hover:underline">
          ← Back to Staff List
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6">
            <button
              onClick={() => router.push(settingsStaffPath)}
              className="text-blue-600 dark:text-blue-400 hover:underline mb-2"
            >
              ← Back to Staff List
            </button>
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">{staff.name}</h1>
                <p className="text-gray-600 dark:text-gray-400">{staff.position || "No position"}</p>
              </div>
              <button
                onClick={() => router.push(`${payrollBase}/staff/${staffId}/edit`)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                Edit Staff
              </button>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            <a
              href="#salary-payslips"
              className="inline-flex items-center rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Salary &amp; Payslips
            </a>
          </div>

          {/* Staff Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Personal Information</h2>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Phone</p>
                  <p className="text-gray-900 dark:text-white">{staff.phone || "—"}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">WhatsApp</p>
                  <p className="text-gray-900 dark:text-white">{staff.whatsapp_phone || "—"}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Email</p>
                  <p className="text-gray-900 dark:text-white">{staff.email || "—"}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Employment type</p>
                  <p className="text-gray-900 dark:text-white">{formatEmploymentTypeLabel(staff.employment_type)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Start Date</p>
                  <p className="text-gray-900 dark:text-white">
                    {staff.start_date ? new Date(staff.start_date).toLocaleDateString() : "—"}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Salary & Banking</h2>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Basic Salary</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">₵{Number(staff.basic_salary).toFixed(2)}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Salary basis: {staff.salary_basis || "monthly"} (amount for that basis; no conversion)
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Bank Name</p>
                  <p className="text-gray-900 dark:text-white">{staff.bank_name || "—"}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Bank Account</p>
                  <p className="text-gray-900 dark:text-white">{staff.bank_account || "—"}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">SSNIT Number</p>
                  <p className="text-gray-900 dark:text-white">{staff.ssnit_number || "—"}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">TIN Number</p>
                  <p className="text-gray-900 dark:text-white">{staff.tin_number || "—"}</p>
                </div>
                <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Ghana payroll (PAYE / SSNIT)</p>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-500 dark:text-gray-400">Tax resident</dt>
                      <dd className="text-gray-900 dark:text-white">{staff.is_tax_resident !== false ? "Yes" : "No"}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-500 dark:text-gray-400">Pensionable</dt>
                      <dd className="text-gray-900 dark:text-white">{staff.is_pensionable !== false ? "Yes" : "No"}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-500 dark:text-gray-400">GRA position code</dt>
                      <dd className="text-gray-900 dark:text-white">{staff.gra_position_code || "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-500 dark:text-gray-400">Secondary employment</dt>
                      <dd className="text-gray-900 dark:text-white">{staff.secondary_employment === true ? "Yes" : "No"}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          {/* Salary & Payslips */}
          <div
            id="salary-payslips"
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700 mb-6 scroll-mt-6"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Salary &amp; Payslips</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-3xl">
                  Historical approved payroll, confirmed employee payments and existing payslips. Current salary
                  settings above remain separate from historical payroll figures.
                </p>
              </div>
              {salaryHistory && (
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <span>Year</span>
                  <select
                    value={salaryYear}
                    onChange={(e) => handleSalaryYearChange(e.target.value)}
                    className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white"
                  >
                    <option value="">All years</option>
                    {salaryHistory.available_years.map((year) => (
                      <option key={year} value={String(year)}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {salaryLoading ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading salary history...</p>
            ) : salaryPermissionDenied ? (
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Payroll view or export permission is required to see salary history and payslips.
              </p>
            ) : salaryError ? (
              <div className="space-y-2">
                <p className="text-sm text-red-700 dark:text-red-300">{salaryError}</p>
                <button
                  type="button"
                  onClick={loadSalaryHistory}
                  className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Retry
                </button>
              </div>
            ) : salaryHistory ? (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Current basic salary</p>
                    <p className="mt-1 text-lg font-bold text-gray-900 dark:text-white">
                      GHS {Number(salaryHistory.staff.basic_salary || 0).toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {salaryHistory.staff.salary_basis || "monthly"} basis
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Historical approved net salary</p>
                    <p className="mt-1 text-lg font-bold text-gray-900 dark:text-white">
                      GHS {Number(salaryHistory.summary.total_net_salary || 0).toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {salaryHistory.summary.period_count} payroll period
                      {salaryHistory.summary.period_count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Confirmed paid to employee</p>
                    <p className="mt-1 text-lg font-bold text-emerald-700 dark:text-emerald-400">
                      GHS {Number(salaryHistory.summary.total_confirmed_paid || 0).toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Employee-level batch payments only
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Outstanding (individually established)</p>
                    <p className="mt-1 text-lg font-bold text-amber-700 dark:text-amber-400">
                      GHS {Number(salaryHistory.summary.total_outstanding || 0).toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Excludes unallocated aggregate payments
                    </p>
                  </div>
                </div>

                {(salaryHistory.summary.total_unverified > 0 ||
                  salaryHistory.summary.unallocated_aggregate_payment_total > 0) && (
                  <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-xs text-blue-900 dark:text-blue-200">
                    {salaryHistory.summary.total_unverified > 0 && (
                      <p>
                        GHS {Number(salaryHistory.summary.total_unverified).toFixed(2)} of salary has not been
                        individually verified because it is covered only by run-level aggregate payments.
                      </p>
                    )}
                    {salaryHistory.summary.unallocated_aggregate_payment_total > 0 && (
                      <p>
                        Run-level aggregate payments total GHS{" "}
                        {Number(salaryHistory.summary.unallocated_aggregate_payment_total).toFixed(2)}. They are not
                        attributed to this employee.
                      </p>
                    )}
                  </div>
                )}

                {salaryHistory.summary.total_reversed_net_salary > 0 && (
                  <p className="text-xs text-rose-700 dark:text-rose-300">
                    Reversed payroll net salary excluded from totals: GHS{" "}
                    {Number(salaryHistory.summary.total_reversed_net_salary).toFixed(2)}.
                  </p>
                )}

                {salaryHistory.history.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-6 text-center">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      No approved payroll history for this employee yet.
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Salary history appears after a payroll run is approved. Draft estimates are not historical
                      salary.
                    </p>
                  </div>
                ) : (
                  <>
                  <div className="space-y-3 md:hidden">
                    {salaryHistory.history.map((row) => (
                      <SalaryHistoryMobileCard
                        key={row.payroll_entry_id}
                        row={row}
                        payrollBase={payrollBase}
                      />
                    ))}
                  </div>
                  <div className="hidden md:block overflow-x-auto -mx-1">
                    <table className="w-full min-w-[1080px] text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                          <th className="px-2 py-2 min-w-[200px]">Period</th>
                          <th className="px-2 py-2 text-right">Gross</th>
                          <th className="px-2 py-2 text-right">PAYE</th>
                          <th className="px-2 py-2 text-right">SSNIT</th>
                          <th className="px-2 py-2 text-right">Net salary</th>
                          <th className="px-2 py-2 text-right min-w-[120px]">Outstanding</th>
                          <th className="px-2 py-2 min-w-[250px]">Payment status</th>
                          <th className="px-2 py-2 min-w-[110px]">Payslip</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {salaryHistory.history.map((row) => {
                          const aggregateTotal = row.aggregate_payments.reduce(
                            (sum, payment) => sum + Number(payment.amount || 0),
                            0
                          )
                          const payslipToken = row.payslip?.public_token || null
                          return (
                            <tr key={row.payroll_entry_id}>
                              <td className="px-2 py-3 align-top text-gray-900 dark:text-white">
                                <p className="font-medium">{salaryPeriodLabel(row)}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                  Basic GHS {Number(row.basic_salary || 0).toFixed(2)} · Allowances GHS{" "}
                                  {Number(row.allowances_total || 0).toFixed(2)} · Deductions GHS{" "}
                                  {Number(row.deductions_total || 0).toFixed(2)}
                                </p>
                                {row.is_reversed_run && (
                                  <span className="mt-1 inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
                                    Reversed payroll
                                  </span>
                                )}
                                <a
                                  href={`${payrollBase}/${row.payroll_run_id}`}
                                  className="mt-1 block text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                  Open payroll run
                                </a>
                              </td>
                              <td className="px-2 py-3 text-right tabular-nums text-gray-900 dark:text-white">
                                GHS {Number(row.gross_salary || 0).toFixed(2)}
                              </td>
                              <td className="px-2 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                                GHS {Number(row.paye || 0).toFixed(2)}
                              </td>
                              <td className="px-2 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                                GHS {Number(row.ssnit_employee || 0).toFixed(2)}
                              </td>
                              <td className="px-2 py-3 text-right font-semibold tabular-nums text-gray-900 dark:text-white">
                                GHS {Number(row.net_salary || 0).toFixed(2)}
                              </td>
                              <td className="px-2 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                                {row.outstanding_amount == null ? (
                                  <span className="text-xs text-blue-700 dark:text-blue-300">Not verified</span>
                                ) : (
                                  `GHS ${Number(row.outstanding_amount || 0).toFixed(2)}`
                                )}
                              </td>
                              <td className="px-2 py-3 align-top">
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${paymentStatusClasses(
                                    row.payment_status
                                  )}`}
                                >
                                  {row.payment_status_label}
                                </span>
                                {row.payments.length > 0 && (
                                  <ul className="mt-1 space-y-0.5 text-[11px] text-gray-600 dark:text-gray-300">
                                    {row.payments.map((payment) => (
                                      <li key={payment.id}>
                                        Paid GHS {Number(payment.amount || 0).toFixed(2)}
                                        {payment.payment_date
                                          ? ` on ${new Date(payment.payment_date).toLocaleDateString("en-GH")}`
                                          : ""}
                                        {payment.reference ? ` · ${payment.reference}` : ""}
                                        {payment.payment_method ? ` · ${payment.payment_method}` : ""}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {aggregateTotal > 0 && (
                                  <p className="mt-1 text-[11px] text-blue-700 dark:text-blue-300">
                                    Unallocated aggregate: GHS {aggregateTotal.toFixed(2)} (
                                    {row.aggregate_payments.length})
                                  </p>
                                )}
                                {row.unverified_amount > 0 && (
                                  <p className="mt-1 text-[11px] text-blue-700 dark:text-blue-300">
                                    GHS {Number(row.unverified_amount).toFixed(2)} not individually verified
                                  </p>
                                )}
                              </td>
                              <td className="px-2 py-3 align-top">
                                {payslipToken ? (
                                  <a
                                    href={`/payslips/${encodeURIComponent(payslipToken)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                                  >
                                    View / print
                                  </a>
                                ) : (
                                  <span className="text-xs text-gray-500 dark:text-gray-400">Not generated</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  </>
                )}

                {salaryHistory.pagination.has_more && (
                  <button
                    type="button"
                    onClick={() => setSalaryLimit((n) => n + 24)}
                    className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Load more history
                  </button>
                )}
              </div>
            ) : null}
          </div>

          {/* Payment methods */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700 mb-6">
            <div className="flex justify-between items-start mb-4 gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Payment methods</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-3xl">
                  Payment methods are used for manual salary records and Business-tier Paystack payouts. A Paystack
                  transfer only starts after an authorized user explicitly confirms it in the payroll batch.
                </p>
              </div>
              <button
                type="button"
                onClick={openAddPaymentMethod}
                className="shrink-0 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700"
              >
                + Add method
              </button>
            </div>
            {paymentMethods.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 text-sm">No payment methods saved yet.</p>
            ) : (
              <div className="space-y-4">
                {paymentMethods.map((m) => (
                  <div
                    key={m.id}
                    className="border border-gray-200 dark:border-gray-600 rounded-lg p-4 flex flex-col md:flex-row md:justify-between md:items-start gap-3"
                  >
                    <div className="space-y-1 text-sm text-gray-900 dark:text-white">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">
                          {PAYMENT_METHOD_LABELS[m.method_type] || m.method_type}
                        </span>
                        {m.is_default ? <MiniBadge tone="blue" label="Default" /> : null}
                        <MiniBadge label={verificationLabel(m.verification_status)} />
                      </div>
                      {m.method_type === "bank" ? (
                        <ul className="text-gray-600 dark:text-gray-300 list-disc list-inside">
                          {m.bank_name ? <li>Bank: {m.bank_name}</li> : null}
                          {m.branch_name ? <li>Branch: {m.branch_name}</li> : null}
                          {m.account_number ? <li>Account no.: {maskAccountNumber(m.account_number)}</li> : null}
                          {m.account_name ? <li>Account holder: {m.account_name}</li> : null}
                        </ul>
                      ) : null}
                      {m.method_type === "momo" ? (
                        <ul className="text-gray-600 dark:text-gray-300 list-disc list-inside">
                          {m.momo_provider ? (
                            <li>
                              Provider:{" "}
                              {normalizeGhanaMomoProvider(m.momo_provider)?.label || m.momo_provider}
                            </li>
                          ) : null}
                          {m.momo_number ? <li>Number: {maskMomoNumber(m.momo_number)}</li> : null}
                          {m.account_name ? <li>Account holder: {m.account_name}</li> : null}
                        </ul>
                      ) : null}
                      {m.paystack_recipient_code ? (
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                          Paystack recipient linked ({m.paystack_recipient_environment || "test"}).
                        </p>
                      ) : null}
                      {m.method_type === "cash" ? (
                        <p className="text-gray-600 dark:text-gray-300">
                          Cash payment / manual handling - record payouts outside integrated transfers.
                        </p>
                      ) : null}
                      {m.provider_name ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400">Note: {m.provider_name}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      {!m.is_default ? (
                        <button
                          type="button"
                          onClick={() => runSetDefaultPaymentMethod(m.id)}
                          className="text-sm px-3 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          Set as default
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => openEditPaymentMethod(m)}
                        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePaymentMethod(m.id)}
                        className="text-sm text-red-600 dark:text-red-400 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Allowances */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Allowances</h2>
              <button
                onClick={() => {
                  setEditingAllowance(null)
                  setAllowanceForm({ type: "", amount: "", recurring: true, description: "" })
                  setShowAllowanceModal(true)
                }}
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
              >
                + Add Allowance
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Type</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300">Amount</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Recurring</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Description</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {allowances.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-4 text-center text-gray-500 dark:text-gray-400">
                        No allowances added yet
                      </td>
                    </tr>
                  ) : (
                    allowances.map((allowance) => (
                      <tr key={allowance.id}>
                        <td className="px-4 py-2 text-gray-900 dark:text-white">{allowance.type}</td>
                        <td className="px-4 py-2 text-right text-gray-900 dark:text-white">₵{Number(allowance.amount).toFixed(2)}</td>
                        <td className="px-4 py-2 text-gray-900 dark:text-white">{allowance.recurring ? "Yes" : "No"}</td>
                        <td className="px-4 py-2 text-gray-900 dark:text-white">{allowance.description || "—"}</td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => openEditAllowance(allowance)}
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 mr-3"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteAllowance(allowance.id)}
                            className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Deductions */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Deductions</h2>
              <button
                onClick={() => {
                  setEditingDeduction(null)
                  setDeductionForm({ type: "", amount: "", recurring: true, description: "" })
                  setShowDeductionModal(true)
                }}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
              >
                + Add Deduction
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Type</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300">Amount</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Recurring</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Description</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {deductions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-4 text-center text-gray-500 dark:text-gray-400">
                        No deductions added yet
                      </td>
                    </tr>
                  ) : (
                    deductions.map((deduction) => (
                      <tr key={deduction.id}>
                        <td className="px-4 py-2 text-gray-900 dark:text-white">{deduction.type}</td>
                        <td className="px-4 py-2 text-right text-gray-900 dark:text-white">₵{Number(deduction.amount).toFixed(2)}</td>
                        <td className="px-4 py-2 text-gray-900 dark:text-white">{deduction.recurring ? "Yes" : "No"}</td>
                        <td className="px-4 py-2 text-gray-900 dark:text-white">{deduction.description || "—"}</td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => openEditDeduction(deduction)}
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 mr-3"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteDeduction(deduction.id)}
                            className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Allowance Modal */}
      {showAllowanceModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              {editingAllowance ? "Edit Allowance" : "Add Allowance"}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Type *</label>
                <select
                  value={allowanceForm.type}
                  onChange={(e) => setAllowanceForm({ ...allowanceForm, type: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                >
                  <option value="">Select type</option>
                  {ALLOWANCE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Amount (₵) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={allowanceForm.amount}
                  onChange={(e) => setAllowanceForm({ ...allowanceForm, amount: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Staff allowances created here are recurring (once per matching pay period). Assign
                one-off allowances from a draft payroll run.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Description</label>
                <textarea
                  value={allowanceForm.description}
                  onChange={(e) => setAllowanceForm({ ...allowanceForm, description: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  rows={3}
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleSaveAllowance}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setShowAllowanceModal(false)
                  setEditingAllowance(null)
                  setAllowanceForm({ type: "", amount: "", recurring: true, description: "" })
                }}
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deduction Modal */}
      {showDeductionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              {editingDeduction ? "Edit Deduction" : "Add Deduction"}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Type *</label>
                <select
                  value={deductionForm.type}
                  onChange={(e) => setDeductionForm({ ...deductionForm, type: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                >
                  <option value="">Select type</option>
                  {DEDUCTION_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Amount (₵) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={deductionForm.amount}
                  onChange={(e) => setDeductionForm({ ...deductionForm, amount: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Staff deductions created here are recurring (once per matching pay period). Assign
                one-off deductions from a draft payroll run.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Description</label>
                <textarea
                  value={deductionForm.description}
                  onChange={(e) => setDeductionForm({ ...deductionForm, description: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  rows={3}
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleSaveDeduction}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setShowDeductionModal(false)
                  setEditingDeduction(null)
                  setDeductionForm({ type: "", amount: "", recurring: true, description: "" })
                }}
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Method Modal */}
      {showPaymentMethodModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              {editingPaymentMethod ? "Edit payment method" : "Add payment method"}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Used for manual salary records and confirmed Paystack payouts. No transfer starts from this dialog.
            </p>
            {Object.keys(paymentMethodErrors).length > 0 ? (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
              >
                Please correct the highlighted fields before saving.
              </div>
            ) : null}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Method *</label>
                <select
                  value={paymentMethodForm.method_type}
                  onChange={(e) => {
                    const method_type = e.target.value as "bank" | "momo" | "cash"
                    setPaymentMethodErrors({})
                    setPaymentMethodForm((f) => ({
                      ...f,
                      method_type,
                      bank_name: method_type === "bank" ? f.bank_name : "",
                      bank_code: method_type === "bank" ? f.bank_code : "",
                      branch_name: method_type === "bank" ? f.branch_name : "",
                      account_number: method_type === "bank" ? f.account_number : "",
                      account_name: method_type === "momo" || method_type === "bank" ? f.account_name : "",
                      momo_provider: method_type === "momo" ? f.momo_provider : "",
                      momo_number: method_type === "momo" ? f.momo_number : "",
                    }))
                  }}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="bank">Bank transfer</option>
                  <option value="momo">Mobile money</option>
                  <option value="cash">Cash</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Label / note (optional)
                </label>
                <input
                  value={paymentMethodForm.provider_name}
                  onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, provider_name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="e.g. Primary salary account"
                />
              </div>
              {paymentMethodForm.method_type === "bank" ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Bank name *
                    </label>
                    {paystackDestinations && paystackDestinations.banks.length > 0 ? (
                      <select
                        value={paymentMethodForm.bank_code}
                        onChange={(e) => {
                          const selected = paystackDestinations.banks.find(
                            (bank) => bank.code === e.target.value
                          )
                          setPaymentMethodForm({
                            ...paymentMethodForm,
                            bank_code: e.target.value,
                            bank_name: selected?.name || "",
                          })
                          clearPaymentMethodFieldError("bank_name")
                        }}
                        className={paymentMethodInputClass("bank_name")}
                      >
                        <option value="">Select a supported Ghana bank</option>
                        {paystackDestinations.banks.map((bank) => (
                          <option key={bank.code} value={bank.code}>
                            {bank.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={paymentMethodForm.bank_name}
                        onChange={(e) => {
                          setPaymentMethodForm({ ...paymentMethodForm, bank_name: e.target.value })
                          clearPaymentMethodFieldError("bank_name")
                        }}
                        className={paymentMethodInputClass("bank_name")}
                        placeholder="Bank name"
                        aria-invalid={Boolean(paymentMethodErrors.bank_name)}
                      />
                    )}
                    {paymentMethodErrors.bank_name ? (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {paymentMethodErrors.bank_name}
                      </p>
                    ) : null}
                    {loadingPaystackDestinations ? (
                      <p className="mt-1 text-[11px] text-gray-500">Loading Paystack banks…</p>
                    ) : paystackDestinations ? (
                      <p className="mt-1 text-[11px] text-gray-500">
                        Paystack-supported bank list · {paystackDestinations.environment} mode
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] text-gray-500">
                        Connect Paystack in settings to select a supported bank code.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Branch (optional)
                    </label>
                    <input
                      value={paymentMethodForm.branch_name}
                      onChange={(e) =>
                        setPaymentMethodForm({ ...paymentMethodForm, branch_name: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Account number *
                    </label>
                    <input
                      value={paymentMethodForm.account_number}
                      onChange={(e) => {
                        setPaymentMethodForm({ ...paymentMethodForm, account_number: e.target.value })
                        clearPaymentMethodFieldError("account_number")
                      }}
                      className={paymentMethodInputClass("account_number")}
                      placeholder="e.g. 1234567890"
                      inputMode="numeric"
                      aria-invalid={Boolean(paymentMethodErrors.account_number)}
                    />
                    <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                      Enter 8–20 digits without spaces.
                    </p>
                    {paymentMethodErrors.account_number ? (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {paymentMethodErrors.account_number}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Account holder name *
                    </label>
                    <input
                      value={paymentMethodForm.account_name}
                      onChange={(e) => {
                        setPaymentMethodForm({ ...paymentMethodForm, account_name: e.target.value })
                        clearPaymentMethodFieldError("account_name")
                      }}
                      className={paymentMethodInputClass("account_name")}
                      placeholder="Name on the bank account"
                      aria-invalid={Boolean(paymentMethodErrors.account_name)}
                    />
                    <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                      Enter the name exactly as it appears on the bank account.
                    </p>
                    {paymentMethodErrors.account_name ? (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {paymentMethodErrors.account_name}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Bank code {paystackDestinations ? "" : "(optional)"}
                    </label>
                    <input
                      value={paymentMethodForm.bank_code}
                      readOnly={Boolean(paystackDestinations && paystackDestinations.banks.length > 0)}
                      onChange={(e) =>
                        setPaymentMethodForm({ ...paymentMethodForm, bank_code: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white read-only:bg-gray-100 dark:read-only:bg-gray-800"
                    />
                  </div>
                </>
              ) : null}
              {paymentMethodForm.method_type === "momo" ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Provider *
                    </label>
                    {paystackDestinations && paystackDestinations.mobile_money.length > 0 ? (
                      <select
                        value={paymentMethodForm.momo_provider}
                        onChange={(e) => {
                          setPaymentMethodForm({ ...paymentMethodForm, momo_provider: e.target.value })
                          clearPaymentMethodFieldError("momo_provider")
                        }}
                        className={paymentMethodInputClass("momo_provider")}
                        aria-invalid={Boolean(paymentMethodErrors.momo_provider)}
                      >
                        <option value="">Select a Mobile Money network</option>
                        {paystackDestinations.mobile_money.map((network) => (
                          <option key={network.code} value={network.code}>
                            {network.label || network.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={paymentMethodForm.momo_provider}
                        onChange={(e) => {
                          setPaymentMethodForm({ ...paymentMethodForm, momo_provider: e.target.value })
                          clearPaymentMethodFieldError("momo_provider")
                        }}
                        className={paymentMethodInputClass("momo_provider")}
                        placeholder="e.g. MTN, Telecel, AirtelTigo"
                        aria-invalid={Boolean(paymentMethodErrors.momo_provider)}
                      />
                    )}
                    {paymentMethodErrors.momo_provider ? (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {paymentMethodErrors.momo_provider}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-gray-500">
                      {paystackDestinations
                        ? "Paystack supports MTN, Telecel (Vodafone) and AirtelTigo in Ghana."
                        : "Connect Paystack in settings to load supported networks."}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      MoMo number *
                    </label>
                    <input
                      value={paymentMethodForm.momo_number}
                      onChange={(e) => {
                        setPaymentMethodForm({ ...paymentMethodForm, momo_number: e.target.value })
                        clearPaymentMethodFieldError("momo_number")
                      }}
                      className={paymentMethodInputClass("momo_number")}
                      placeholder="e.g. 0241234567"
                      inputMode="tel"
                      aria-invalid={Boolean(paymentMethodErrors.momo_number)}
                    />
                    <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                      Ghana number, e.g. 0241234567 or +233241234567.
                    </p>
                    {paymentMethodErrors.momo_number ? (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {paymentMethodErrors.momo_number}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Account holder name *
                    </label>
                    <input
                      value={paymentMethodForm.account_name}
                      onChange={(e) => {
                        setPaymentMethodForm({ ...paymentMethodForm, account_name: e.target.value })
                        clearPaymentMethodFieldError("account_name")
                      }}
                      className={paymentMethodInputClass("account_name")}
                      placeholder="Name registered on the Mobile Money account"
                      aria-invalid={Boolean(paymentMethodErrors.account_name)}
                    />
                    <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                      Enter the name registered on this Mobile Money number.
                    </p>
                    {paymentMethodErrors.account_name ? (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {paymentMethodErrors.account_name}
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}
              {paymentMethodForm.method_type === "cash" ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  No bank or MoMo details required. Salary can be settled manually outside integrated payouts.
                </p>
              ) : null}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={paymentMethodForm.is_default}
                  onChange={(e) =>
                    setPaymentMethodForm({ ...paymentMethodForm, is_default: e.target.checked })
                  }
                  className="w-5 h-5"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Use as default for exports & planning</span>
              </label>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={handleSavePaymentMethod}
                className="flex-1 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPaymentMethodModal(false)
                  setEditingPaymentMethod(null)
                  setPaymentMethodForm(emptyPaymentMethodForm())
                  setPaymentMethodErrors({})
                }}
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

