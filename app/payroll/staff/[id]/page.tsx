"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { useToast } from "@/components/ui/ToastProvider"
import { useConfirm } from "@/components/ui/ConfirmProvider"
import { ALLOWANCE_TYPE_OPTIONS, DEDUCTION_TYPE_OPTIONS } from "@/lib/payrollTypes"
import { usePayrollBasePath } from "@/lib/payrollBasePathContext"

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
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bank: "Bank transfer",
  momo: "Mobile money",
  cash: "Cash",
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

  useEffect(() => {
    loadStaff()
  }, [staffId])

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

  const openAddPaymentMethod = () => {
    setEditingPaymentMethod(null)
    setPaymentMethodForm(emptyPaymentMethodForm())
    setShowPaymentMethodModal(true)
  }

  const openEditPaymentMethod = (m: StaffPaymentMethod) => {
    setEditingPaymentMethod(m)
    const mtKnown =
      m.method_type === "bank" || m.method_type === "momo" || m.method_type === "cash"
        ? m.method_type
        : "bank"
    setPaymentMethodForm({
      method_type: mtKnown,
      provider_name: m.provider_name || "",
      bank_name: m.bank_name || "",
      bank_code: m.bank_code || "",
      branch_name: m.branch_name || "",
      account_number: m.account_number || "",
      account_name: m.account_name || "",
      momo_provider: m.momo_provider || "",
      momo_number: m.momo_number || "",
      is_default: m.is_default,
    })
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

          {/* Payment methods */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700 mb-6">
            <div className="flex justify-between items-start mb-4 gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Payment methods</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-3xl">
                  Payment methods are stored for payroll planning and future salary payment workflows. Finza does not
                  send money from this screen.
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
                        <MiniBadge label={`Status: ${m.verification_status}`} />
                      </div>
                      {m.method_type === "bank" ? (
                        <ul className="text-gray-600 dark:text-gray-300 list-disc list-inside">
                          {m.bank_name ? <li>Bank: {m.bank_name}</li> : null}
                          {m.branch_name ? <li>Branch: {m.branch_name}</li> : null}
                          {m.account_number ? <li>Account no.: {m.account_number}</li> : null}
                          {m.account_name ? <li>Account name: {m.account_name}</li> : null}
                          {m.bank_code ? <li>Bank code: {m.bank_code}</li> : null}
                        </ul>
                      ) : null}
                      {m.method_type === "momo" ? (
                        <ul className="text-gray-600 dark:text-gray-300 list-disc list-inside">
                          {m.momo_provider ? <li>Provider: {m.momo_provider}</li> : null}
                          {m.momo_number ? <li>Number: {m.momo_number}</li> : null}
                          {m.account_name ? <li>Registered name: {m.account_name}</li> : null}
                        </ul>
                      ) : null}
                      {m.method_type === "cash" ? (
                        <p className="text-gray-600 dark:text-gray-300">
                          Cash payment / manual handling — record payouts outside integrated transfers.
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
              For planning only — no funds are transferred from Finza.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Method *</label>
                <select
                  value={paymentMethodForm.method_type}
                  onChange={(e) => {
                    const method_type = e.target.value as "bank" | "momo" | "cash"
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
                    <input
                      value={paymentMethodForm.bank_name}
                      onChange={(e) =>
                        setPaymentMethodForm({ ...paymentMethodForm, bank_name: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
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
                      onChange={(e) =>
                        setPaymentMethodForm({ ...paymentMethodForm, account_number: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Account name (recommended)
                    </label>
                    <input
                      value={paymentMethodForm.account_name}
                      onChange={(e) =>
                        setPaymentMethodForm({ ...paymentMethodForm, account_name: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Bank code (optional)
                    </label>
                    <input
                      value={paymentMethodForm.bank_code}
                      onChange={(e) =>
                        setPaymentMethodForm({ ...paymentMethodForm, bank_code: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
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
                    <input
                      value={paymentMethodForm.momo_provider}
                      onChange={(e) =>
                        setPaymentMethodForm({ ...paymentMethodForm, momo_provider: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      placeholder="e.g. MTN, Vodafone"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      MoMo number *
                    </label>
                    <input
                      value={paymentMethodForm.momo_number}
                      onChange={(e) =>
                        setPaymentMethodForm({ ...paymentMethodForm, momo_number: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Registered name (optional)
                    </label>
                    <input
                      value={paymentMethodForm.account_name}
                      onChange={(e) =>
                        setPaymentMethodForm({ ...paymentMethodForm, account_name: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
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

