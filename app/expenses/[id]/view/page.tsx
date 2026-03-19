"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams, usePathname } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"

const FragmentWrapper = ({ children }: { children: React.ReactNode }) => <>{children}</>
import { getCurrentBusiness } from "@/lib/business"

type Expense = {
  id: string
  supplier: string
  date: string
  amount: number
  nhil: number
  getfund: number
  covid: number
  vat: number
  total: number
  notes: string | null
  receipt_path: string | null
  expense_categories: {
    id: string
    name: string
  } | null
}

export default function ViewExpensePage() {
  const router = useRouter()
  const params = useParams()
  const pathname = usePathname()
  const expenseId = (params?.id as string) ?? ""
  const isUnderService = pathname?.startsWith("/service") ?? false
  const Wrapper = isUnderService ? FragmentWrapper : ProtectedLayout
  
  const [loading, setLoading] = useState(true)
  const [expense, setExpense] = useState<Expense | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!expenseId) {
      setError("Expense ID is missing")
      setLoading(false)
      return
    }
    loadExpense()
  }, [expenseId])

  const loadExpense = async () => {
    if (!expenseId) return
    try {
      setLoading(true)
      setError("")
      const response = await fetch(`/api/expenses/${expenseId}`)
      const body = await response.json()

      if (process.env.NODE_ENV === "development") {
        console.log("[expenses/view] loadExpense", {
          expenseId,
          status: response.status,
          ok: response.ok,
          error: body?.error,
          hasExpense: !!body?.expense,
        })
      }

      if (!response.ok) {
        if (response.status === 404) {
          setError("Expense not found")
          setExpense(null)
        } else {
          setError(body?.error || "Failed to load expense")
        }
        setLoading(false)
        return
      }

      setExpense(body.expense ?? null)
      if (!body.expense) {
        setError("Expense not found")
      }
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load expense")
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <Wrapper>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </Wrapper>
    )
  }

  if (error || !expense) {
    return (
      <Wrapper>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error || "Expense not found"}
          </div>
        </div>
      </Wrapper>
    )
  }

  const totalTaxes = Number(expense.nhil || 0) + Number(expense.getfund || 0) + Number(expense.covid || 0) + Number(expense.vat || 0)
  const hasTaxes = totalTaxes > 0

  return (
    <Wrapper>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <button
              onClick={() => router.push(isUnderService ? "/service/expenses" : "/expenses")}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4 flex items-center gap-2 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Expenses
            </button>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                  Expense Details
                </h1>
                <p className="text-gray-600 dark:text-gray-400">View expense information and receipt</p>
              </div>
              <button
                onClick={() => router.push(isUnderService ? `/service/expenses/${expenseId}/edit` : `/expenses/${expenseId}/edit`)}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-2 rounded-lg hover:from-blue-700 hover:to-indigo-700 font-medium shadow-lg transition-all"
              >
                Edit Expense
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Details */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Expense Information</h2>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-semibold text-gray-500 dark:text-gray-400">Supplier</label>
                    <p className="text-lg font-medium text-gray-900 dark:text-white mt-1">{expense.supplier}</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-semibold text-gray-500 dark:text-gray-400">Date</label>
                      <p className="text-lg font-medium text-gray-900 dark:text-white mt-1">
                        {new Date(expense.date).toLocaleDateString()}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-gray-500 dark:text-gray-400">Category</label>
                      <p className="text-lg font-medium text-gray-900 dark:text-white mt-1">
                        {expense.expense_categories?.name || "Uncategorized"}
                      </p>
                    </div>
                  </div>

                  {expense.notes && (
                    <div>
                      <label className="text-sm font-semibold text-gray-500 dark:text-gray-400">Notes</label>
                      <p className="text-gray-900 dark:text-white mt-1 whitespace-pre-wrap">{expense.notes}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Tax Breakdown */}
              {hasTaxes && (
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Tax Breakdown</h2>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600 dark:text-gray-400">Subtotal:</span>
                      <span className="font-semibold text-gray-900 dark:text-white">₵{Number(expense.amount).toFixed(2)}</span>
                    </div>
                    <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-600 dark:text-gray-400">NHIL (2.5%):</span>
                        <span className="text-gray-700 dark:text-gray-300">₵{Number(expense.nhil || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-600 dark:text-gray-400">GETFund (2.5%):</span>
                        <span className="text-gray-700 dark:text-gray-300">₵{Number(expense.getfund || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-600 dark:text-gray-400">VAT (15%):</span>
                        <span className="text-gray-700 dark:text-gray-300">₵{Number(expense.vat || 0).toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="flex justify-between items-center pt-3 border-t-2 border-gray-300 dark:border-gray-600">
                      <span className="text-gray-900 dark:text-white font-bold text-lg">Total:</span>
                      <span className="font-bold text-blue-600 dark:text-blue-400 text-xl">₵{Number(expense.total).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )}

              {!hasTaxes && (
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-900 dark:text-white font-bold text-lg">Total:</span>
                    <span className="font-bold text-blue-600 dark:text-blue-400 text-xl">₵{Number(expense.total).toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Receipt Preview */}
            <div className="lg:col-span-1">
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700 sticky top-8">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Receipt</h2>
                {expense.receipt_path ? (
                  <div>
                    {expense.receipt_path.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                      <img
                        src={expense.receipt_path}
                        alt="Receipt"
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 mb-4"
                      />
                    ) : (
                      <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center">
                        <svg className="w-12 h-12 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                        <p className="text-gray-500 dark:text-gray-400 text-sm mb-2">PDF Receipt</p>
                        <a
                          href={expense.receipt_path}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline text-sm"
                        >
                          View PDF
                        </a>
                      </div>
                    )}
                    <a
                      href={expense.receipt_path}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full bg-blue-600 text-white text-center px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Download Receipt
                    </a>
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center">
                    <svg className="w-12 h-12 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <p className="text-gray-500 dark:text-gray-400 text-sm">No receipt uploaded</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Wrapper>
  )
}