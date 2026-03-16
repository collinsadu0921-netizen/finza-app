"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useToast } from "@/components/ui/ToastProvider"

type PayrollEntry = {
  id: string
  basic_salary: number
  allowances_total: number
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

export default function PayrollRunViewPage() {
  const router = useRouter()
  const params = useParams()
  const runId = params.id as string
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [payrollRun, setPayrollRun] = useState<PayrollRun | null>(null)
  const [entries, setEntries] = useState<PayrollEntry[]>([])
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    loadPayrollRun()
  }, [runId])

  const loadPayrollRun = async () => {
    try {
      const response = await fetch(`/api/payroll/runs/${runId}`)
      const data = await response.json()

      if (response.ok) {
        setPayrollRun(data.payrollRun)
        setEntries(data.entries || [])
      } else {
        console.error("Error loading payroll run:", data.error)
      }
    } catch (error) {
      console.error("Error loading payroll run:", error)
    } finally {
      setLoading(false)
    }
  }

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
      } else {
        toast.showToast(data.error || "Error approving payroll run", "error")
      }
    } catch (error) {
      console.error("Error approving payroll run:", error)
      toast.showToast("Error approving payroll run", "error")
    } finally {
      setUpdating(false)
    }
  }

  const handleGeneratePayslips = async () => {
    try {
      const response = await fetch(`/api/payroll/runs/${runId}/generate-payslips`, {
        method: "POST",
      })

      const data = await response.json()

      if (response.ok) {
        toast.showToast(`Generated ${data.payslips.length} payslips`, "success")
      } else {
        toast.showToast(data.error || "Error generating payslips", "error")
      }
    } catch (error) {
      console.error("Error generating payslips:", error)
      toast.showToast("Error generating payslips", "error")
    }
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

  if (!payrollRun) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p>Payroll run not found</p>
        </div>
      </ProtectedLayout>
    )
  }

  const formatMonth = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString("en-GH", { month: "long", year: "numeric" })
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <button
                onClick={() => router.push("/payroll")}
                className="text-blue-600 dark:text-blue-400 hover:underline mb-2"
              >
                ← Back to Payroll
              </button>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                Payroll Run - {formatMonth(payrollRun.payroll_month)}
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                Status: <span className="font-semibold">{payrollRun.status}</span>
              </p>
            </div>
            <div className="flex gap-3">
              {/* AUTH DISABLED FOR DEVELOPMENT - Allow editing even when approved */}
              <button
                onClick={handleApprove}
                disabled={updating}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {payrollRun.status === "approved" ? "Re-approve Payroll" : "Approve Payroll"}
              </button>
              <button
                onClick={handleGeneratePayslips}
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
              >
                Generate Payslips
              </button>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-2">Gross Salary</h3>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                ₵{Number(payrollRun.total_gross_salary || 0).toFixed(2)}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-2">PAYE</h3>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                ₵{Number(payrollRun.total_paye || 0).toFixed(2)}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-2">SSNIT (Total)</h3>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                ₵{Number((payrollRun.total_ssnit_employee || 0) + (payrollRun.total_ssnit_employer || 0)).toFixed(2)}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-2">Net Salary</h3>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                ₵{Number(payrollRun.total_net_salary || 0).toFixed(2)}
              </p>
            </div>
          </div>

          {/* Payroll Entries Table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Staff
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Basic Salary
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Allowances
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Deductions
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Gross
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      PAYE
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Net
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{entry.staff.name}</p>
                          {entry.staff.position && (
                            <p className="text-xs text-gray-500 dark:text-gray-400">{entry.staff.position}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 dark:text-white">
                        ₵{Number(entry.basic_salary || 0).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 dark:text-white">
                        ₵{Number(entry.allowances_total || 0).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-600 dark:text-red-400">
                        -₵{Number(entry.deductions_total || 0).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 dark:text-white">
                        ₵{Number(entry.gross_salary || 0).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-600 dark:text-red-400">
                        -₵{Number(entry.paye || 0).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-green-600 dark:text-green-400">
                        ₵{Number(entry.net_salary || 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}


