"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import LoadingScreen from "@/components/ui/LoadingScreen"
import PageHeader from "@/components/ui/PageHeader"
import Button from "@/components/ui/Button"
import EmptyState from "@/components/ui/EmptyState"
import { useToast } from "@/components/ui/ToastProvider"
import { exportToCSV, exportToExcel, ExportColumn, formatCurrencyRaw, formatDate, formatYesNo } from "@/lib/exportUtils"
import { formatMoney } from "@/lib/money"

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

export default function ExpensesPage() {
  const router = useRouter()
  const toast = useToast()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [filters, setFilters] = useState({
    category_id: "",
    start_date: "",
    end_date: "",
  })
  const [searchInput, setSearchInput] = useState<string>("")
  const [searchQuery, setSearchQuery] = useState<string>("")
  const [isSearching, setIsSearching] = useState(false)
  const [business, setBusiness] = useState<{ currency_code?: string } | null>(null)
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  // Debounced search effect - updates searchQuery after user stops typing
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }

    if (searchInput.trim()) {
      setIsSearching(true)
    }

    searchDebounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput)
      setIsSearching(false)
    }, 300)

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [searchInput])

  useEffect(() => {
    loadExpenses()
  }, [filters, searchQuery])

  const loadData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) return
      setBusiness(business)

      // Load categories
      const { data: categoriesData } = await supabase
        .from("expense_categories")
        .select("*")
        .eq("business_id", business.id)
        .order("name", { ascending: true })

      setCategories(categoriesData || [])
      loadExpenses()
    } catch (err: any) {
      setError(err.message || "Failed to load data")
      setLoading(false)
    }
  }

  const loadExpenses = async () => {
    try {
      setLoading(true)
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) return

      let query = `/api/expenses/list?`
      if (business?.id) query += `business_id=${business.id}&`
      if (filters.category_id) query += `category_id=${filters.category_id}&`
      if (filters.start_date) query += `start_date=${filters.start_date}&`
      if (filters.end_date) query += `end_date=${filters.end_date}&`

      const response = await fetch(query)
      if (!response.ok) {
        throw new Error("Failed to load expenses")
      }

      const { expenses: expensesData } = await response.json()
      
      // Filter by search query
      let filteredExpenses = expensesData || []
      if (searchQuery.trim()) {
        filteredExpenses = filteredExpenses.filter((exp: Expense) =>
          exp.supplier.toLowerCase().includes(searchQuery.toLowerCase())
        )
      }
      
      setExpenses(filteredExpenses)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load expenses")
      setLoading(false)
    }
  }

  const totalExpenses = expenses.reduce((sum, exp) => sum + Number(exp.total || 0), 0)
  const totalTaxes = expenses.reduce((sum, exp) => sum + Number(exp.nhil || 0) + Number(exp.getfund || 0) + Number(exp.covid || 0) + Number(exp.vat || 0), 0)

  // Export expenses to CSV
  const handleExportCSV = () => {
    try {
      if (expenses.length === 0) {
        toast.showToast("No expenses to export", "error")
        return
      }

      const columns: ExportColumn<Expense>[] = [
        { header: "Expense Date", accessor: (exp) => formatDate(exp.date), width: 15 },
        { header: "Category", accessor: (exp) => exp.expense_categories?.name || "Uncategorized", width: 20 },
        { header: "Description", accessor: (exp) => exp.notes || exp.supplier, width: 40 },
        { header: "Supplier", accessor: (exp) => exp.supplier, width: 25 },
        {
          header: "Amount",
          accessor: (exp) => Number(exp.amount || 0),
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
        {
          header: "VAT",
          accessor: (exp) => {
            const vatAmount = Number(exp.vat || 0)
            return vatAmount > 0 ? vatAmount : null
          },
          formatter: (val) => val ? formatCurrencyRaw(val) : "",
          excelType: "number",
          width: 15,
        },
        { header: "Receipt Attached", accessor: (exp) => formatYesNo(!!exp.receipt_path), width: 15 },
      ]

      exportToCSV(expenses, columns, "expenses")
      toast.showToast("Expenses exported to CSV successfully", "success")
    } catch (error: any) {
      console.error("Export error:", error)
      toast.showToast(error.message || "Failed to export expenses", "error")
    }
  }

  // Export expenses to Excel
  const handleExportExcel = async () => {
    try {
      if (expenses.length === 0) {
        toast.showToast("No expenses to export", "error")
        return
      }

      const columns: ExportColumn<Expense>[] = [
        {
          header: "Expense Date",
          accessor: (exp) => exp.date || "",
          formatter: (val) => val ? formatDate(val) : "",
          excelType: "date",
          width: 15,
        },
        { header: "Category", accessor: (exp) => exp.expense_categories?.name || "Uncategorized", width: 20 },
        { header: "Description", accessor: (exp) => exp.notes || exp.supplier, width: 40 },
        { header: "Supplier", accessor: (exp) => exp.supplier, width: 25 },
        {
          header: "Amount",
          accessor: (exp) => Number(exp.amount || 0),
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
        {
          header: "VAT",
          accessor: (exp) => {
            const vatAmount = Number(exp.vat || 0)
            return vatAmount > 0 ? vatAmount : null
          },
          formatter: (val) => val ? formatCurrencyRaw(val) : "",
          excelType: "number",
          width: 15,
        },
        { header: "Receipt Attached", accessor: (exp) => formatYesNo(!!exp.receipt_path), width: 15 },
      ]

      await exportToExcel(expenses, columns, "expenses")
      toast.showToast("Expenses exported to Excel successfully", "success")
    } catch (error: any) {
      console.error("Export error:", error)
      toast.showToast(error.message || "Failed to export expenses", "error")
    }
  }

  if (loading) {
    return (
      
        <LoadingScreen />
      
    )
  }

  return (
    
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PageHeader
            title="Expenses"
            subtitle="Track and manage your business expenses"
            actions={
              <div className="flex gap-2">
                <Button
                  onClick={() => router.push("/service/expenses/categories")}
                  variant="outline"
                  leftIcon={
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                  }
                >
                  Manage Categories
                </Button>
                {expenses.length > 0 && (
                  <>
                    <Button
                      onClick={handleExportCSV}
                      variant="outline"
                      leftIcon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      }
                    >
                      Export CSV
                    </Button>
                    <Button
                      onClick={handleExportExcel}
                      variant="outline"
                      leftIcon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      }
                    >
                      Export Excel
                    </Button>
                  </>
                )}
                <Button
                  onClick={() => router.push("/service/expenses/create")}
                  leftIcon={
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  }
                >
                  Add Expense
                </Button>
              </div>
            }
          />

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Search and Filters */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-6 mb-6">
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Search by Supplier
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Type supplier name..."
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white transition-colors"
              />
              {isSearching && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
              <select
                value={filters.category_id}
                onChange={(e) => setFilters({ ...filters, category_id: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white"
              >
                <option value="">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Date</label>
              <input
                type="date"
                value={filters.start_date}
                onChange={(e) => setFilters({ ...filters, start_date: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Date</label>
              <input
                type="date"
                value={filters.end_date}
                onChange={(e) => setFilters({ ...filters, end_date: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={() => {
                  setFilters({ category_id: "", start_date: "", end_date: "" })
                  setSearchQuery("")
                }}
                className="w-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border border-blue-200 dark:border-blue-700 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-blue-900 dark:text-blue-300 font-semibold">Total Expenses:</span>
              <span className="text-blue-900 dark:text-blue-300 font-bold text-xl">{formatMoney(Number(totalExpenses), business?.currency_code || "GHS")}</span>
            </div>
          </div>
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 border border-purple-200 dark:border-purple-700 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-purple-900 dark:text-purple-300 font-semibold">Total Taxes:</span>
              <span className="text-purple-900 dark:text-purple-300 font-bold text-xl">{formatMoney(Number(totalTaxes), business?.currency_code || "GHS")}</span>
            </div>
          </div>
        </div>

        {/* Expenses List */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Supplier</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Category</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Taxes</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Total</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12">
                      <EmptyState
                        icon={
                          <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                        }
                        title="No expenses found"
                        description="Start tracking your business expenses by adding your first expense."
                        actionLabel="Add Expense"
                        onAction={() => router.push("/service/expenses/create")}
                      />
                    </td>
                  </tr>
                ) : (
                  expenses.map((expense) => {
                    const taxes = Number(expense.nhil || 0) + Number(expense.getfund || 0) + Number(expense.covid || 0) + Number(expense.vat || 0)
                    return (
                      <tr key={expense.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                          {new Date(expense.date).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">{expense.supplier}</td>
                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                          {expense.expense_categories?.name || "Uncategorized"}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{formatMoney(Number(expense.amount), business?.currency_code || "GHS")}</td>
                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{formatMoney(Number(taxes), business?.currency_code || "GHS")}</td>
                        <td className="px-6 py-4 text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {formatMoney(Number(expense.total), business?.currency_code || "GHS")}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => router.push(`/service/expenses/${expense.id}/view`)}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
                            >
                              View
                            </button>
                            <button
                              onClick={() => router.push(`/service/expenses/${expense.id}/edit`)}
                              className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium"
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      </div>
    
  )
}

