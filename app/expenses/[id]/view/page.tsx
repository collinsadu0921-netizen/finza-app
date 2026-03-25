"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams, usePathname } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"

const FragmentWrapper = ({ children }: { children: React.ReactNode }) => <>{children}</>
import { getCurrencySymbol } from "@/lib/currency"

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
  currency_code?: string | null
  currency_symbol?: string | null
  fx_rate?: number | null
  home_currency_code?: string | null
  home_currency_total?: number | null
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
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <svg className="animate-spin h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      </Wrapper>
    )
  }

  if (error || !expense) {
    return (
      <Wrapper>
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm max-w-md w-full">
            {error || "Expense not found"}
          </div>
        </div>
      </Wrapper>
    )
  }

  const totalTaxes = Number(expense.nhil || 0) + Number(expense.getfund || 0) + Number(expense.covid || 0) + Number(expense.vat || 0)
  const hasTaxes = totalTaxes > 0

  const homeCode = expense.home_currency_code || "GHS"
  const isFx = !!(
    expense.fx_rate &&
    expense.currency_code &&
    expense.currency_code !== homeCode
  )
  const docCode = isFx ? expense.currency_code! : homeCode
  const docSymbol =
    expense.currency_symbol || getCurrencySymbol(docCode) || docCode || "₵"
  const homeSymbol = getCurrencySymbol(homeCode) || homeCode || "₵"

  return (
    <Wrapper>
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

          {/* Back + Header card */}
          <div>
            <button
              onClick={() => router.push(isUnderService ? "/service/expenses" : "/expenses")}
              className="text-slate-500 hover:text-slate-800 mb-4 flex items-center gap-1.5 text-sm font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Expenses
            </button>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-slate-900">{expense.supplier}</h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  {new Date(expense.date).toLocaleDateString("en-GH", { year: "numeric", month: "long", day: "numeric" })}
                  {expense.expense_categories?.name ? ` · ${expense.expense_categories.name}` : ""}
                </p>
              </div>
              <button
                onClick={() => router.push(isUnderService ? `/service/expenses/${expenseId}/edit` : `/expenses/${expenseId}/edit`)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Details */}
            <div className="lg:col-span-2 space-y-5">
              {/* Info card */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Expense Details</h2>
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Supplier</p>
                    <p className="text-sm font-semibold text-slate-800">{expense.supplier}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Date</p>
                    <p className="text-sm font-semibold text-slate-800">
                      {new Date(expense.date).toLocaleDateString("en-GH", { year: "numeric", month: "short", day: "numeric" })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Category</p>
                    <p className="text-sm font-semibold text-slate-800">{expense.expense_categories?.name || "Uncategorized"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Total Amount</p>
                    <p className="text-sm font-bold text-slate-900">
                      {docSymbol}
                      {Number(expense.total).toFixed(2)}
                      {isFx && expense.home_currency_total != null && (
                        <span className="block text-xs font-normal text-slate-500 mt-1">
                          Booked in {homeCode}: {homeSymbol}
                          {Number(expense.home_currency_total).toFixed(2)} (rate{" "}
                          {Number(expense.fx_rate).toFixed(4)})
                        </span>
                      )}
                    </p>
                  </div>
                  {expense.notes && (
                    <div className="col-span-2">
                      <p className="text-xs text-slate-500 mb-0.5">Notes</p>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{expense.notes}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Tax Breakdown */}
              {hasTaxes && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Tax Breakdown</h2>
                  <div className="space-y-2.5">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-500">Subtotal</span>
                      <span className="font-medium text-slate-800">
                        {docSymbol}
                        {Number(expense.amount).toFixed(2)}
                      </span>
                    </div>
                    <div className="border-t border-slate-100 pt-2.5 space-y-2">
                      {Number(expense.nhil || 0) > 0 && (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-slate-500">NHIL (2.5%)</span>
                          <span className="text-slate-700">
                            {docSymbol}
                            {Number(expense.nhil).toFixed(2)}
                          </span>
                        </div>
                      )}
                      {Number(expense.getfund || 0) > 0 && (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-slate-500">GETFund (2.5%)</span>
                          <span className="text-slate-700">
                            {docSymbol}
                            {Number(expense.getfund).toFixed(2)}
                          </span>
                        </div>
                      )}
                      {Number(expense.vat || 0) > 0 && (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-slate-500">VAT (15%)</span>
                          <span className="text-slate-700">
                            {docSymbol}
                            {Number(expense.vat).toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex justify-between items-center pt-3 border-t-2 border-slate-200">
                      <span className="text-sm font-bold text-slate-900">Total</span>
                      <span className="font-bold text-slate-900">
                        {docSymbol}
                        {Number(expense.total).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {!hasTaxes && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-semibold text-slate-700">Total</span>
                    <span className="text-lg font-bold text-slate-900">
                      {docSymbol}
                      {Number(expense.total).toFixed(2)}
                    </span>
                  </div>
                  {isFx && expense.home_currency_total != null && (
                    <p className="text-xs text-slate-500 mt-2">
                      Booked in {homeCode}: {homeSymbol}
                      {Number(expense.home_currency_total).toFixed(2)} (rate {Number(expense.fx_rate).toFixed(4)})
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Receipt Preview */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sticky top-8">
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Receipt</h2>
                {expense.receipt_path ? (
                  <div className="space-y-3">
                    {expense.receipt_path.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                      <img
                        src={expense.receipt_path}
                        alt="Receipt"
                        className="w-full rounded-lg border border-slate-200"
                      />
                    ) : (
                      <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center">
                        <svg className="w-10 h-10 text-slate-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                        <p className="text-slate-500 text-sm mb-1">PDF Receipt</p>
                        <a href={expense.receipt_path} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-sm">
                          View PDF
                        </a>
                      </div>
                    )}
                    <a
                      href={expense.receipt_path}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full bg-slate-800 text-white text-center text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-slate-700 transition-colors"
                    >
                      Download Receipt
                    </a>
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center">
                    <svg className="w-10 h-10 text-slate-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <p className="text-slate-400 text-sm">No receipt uploaded</p>
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