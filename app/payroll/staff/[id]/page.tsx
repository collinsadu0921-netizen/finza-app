"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useToast } from "@/components/ui/ToastProvider"
import { useConfirm } from "@/components/ui/ConfirmProvider"
import { ALLOWANCE_TYPE_OPTIONS, DEDUCTION_TYPE_OPTIONS } from "@/lib/payrollTypes"

type Staff = {
  id: string
  name: string
  position: string | null
  phone: string | null
  whatsapp_phone: string | null
  email: string | null
  basic_salary: number
  employment_type: string
  bank_name: string | null
  bank_account: string | null
  ssnit_number: string | null
  tin_number: string | null
  start_date: string
  status: string
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

export default function StaffViewPage() {
  const router = useRouter()
  const params = useParams()
  const staffId = params.id as string
  const toast = useToast()
  const { openConfirm } = useConfirm()

  const [loading, setLoading] = useState(true)
  const [staff, setStaff] = useState<Staff | null>(null)
  const [allowances, setAllowances] = useState<Allowance[]>([])
  const [deductions, setDeductions] = useState<Deduction[]>([])
  const [error, setError] = useState("")
  const [showAllowanceModal, setShowAllowanceModal] = useState(false)
  const [showDeductionModal, setShowDeductionModal] = useState(false)
  const [editingAllowance, setEditingAllowance] = useState<Allowance | null>(null)
  const [editingDeduction, setEditingDeduction] = useState<Deduction | null>(null)

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

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: allowanceForm.type.trim(),
          amount: parseFloat(allowanceForm.amount),
          recurring: allowanceForm.recurring,
          description: allowanceForm.description.trim() || null,
        }),
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

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: deductionForm.type.trim(),
          amount: parseFloat(deductionForm.amount),
          recurring: deductionForm.recurring,
          description: deductionForm.description.trim() || null,
        }),
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

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </ProtectedLayout>
    )
  }

  if (!staff) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p className="text-red-500">{error || "Staff not found"}</p>
          <button onClick={() => router.push("/settings/staff")} className="mt-4 text-blue-600 hover:underline">
            ← Back to Staff List
          </button>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6">
            <button
              onClick={() => router.push("/settings/staff")}
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
                onClick={() => router.push(`/payroll/staff/${staffId}/edit`)}
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
              </div>
            </div>
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
              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={allowanceForm.recurring}
                    onChange={(e) => setAllowanceForm({ ...allowanceForm, recurring: e.target.checked })}
                    className="w-5 h-5"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Recurring</span>
                </label>
              </div>
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
              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={deductionForm.recurring}
                    onChange={(e) => setDeductionForm({ ...deductionForm, recurring: e.target.checked })}
                    className="w-5 h-5"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Recurring</span>
                </label>
              </div>
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
    </ProtectedLayout>
  )
}

