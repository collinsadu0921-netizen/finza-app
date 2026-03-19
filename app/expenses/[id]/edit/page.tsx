"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams, usePathname } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"

const FragmentWrapper = ({ children }: { children: React.ReactNode }) => <>{children}</>
import { getCurrentBusiness } from "@/lib/business"
import { calculateGhanaTaxes, calculateBaseFromTotalIncludingTaxes } from "@/lib/ghanaTaxEngine"
import FileAttachment, { FileInput } from "@/components/ui/FileAttachment"
import { generateStoragePath, uploadFileToStorage, extractFilename } from "@/lib/fileHandling"

type ExpenseCategory = {
  id: string
  name: string
}

export default function EditExpensePage() {
  const router = useRouter()
  const params = useParams()
  const pathname = usePathname()
  const expenseId = (params?.id as string) ?? ""
  const isUnderService = pathname?.startsWith("/service") ?? false
  const Wrapper = isUnderService ? FragmentWrapper : ProtectedLayout
  
  const [loading, setLoading] = useState(false)
  const [loadingData, setLoadingData] = useState(true)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  
  const [supplier, setSupplier] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(new Date().toISOString().split("T")[0])
  const [notes, setNotes] = useState("")
  const [applyTaxes, setApplyTaxes] = useState(true)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [existingReceiptPath, setExistingReceiptPath] = useState<string | null>(null)
  const [removeReceipt, setRemoveReceipt] = useState(false)
  
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [newCategoryDescription, setNewCategoryDescription] = useState("")
  const [creatingCategory, setCreatingCategory] = useState(false)

  useEffect(() => {
    if (!expenseId) {
      setError("Expense ID is missing")
      setLoadingData(false)
      return
    }
    loadData()
  }, [expenseId])

  const loadData = async () => {
    if (!expenseId) return
    try {
      setLoadingData(true)
      setError("")
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Please log in to edit this expense")
        setLoadingData(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoadingData(false)
        return
      }

      setBusinessId(business.id)

      // Ensure default categories are seeded
      await supabase.rpc("seed_default_expense_categories", {
        business_uuid: business.id,
      })

      // Load expense categories
      const { data: categoriesData } = await supabase
        .from("expense_categories")
        .select("id, name")
        .eq("business_id", business.id)
        .order("is_default", { ascending: false }) // Defaults first
        .order("name", { ascending: true })

      setCategories(categoriesData || [])

      // Load expense (API uses server client + business_id scoping)
      const response = await fetch(`/api/expenses/${expenseId}`)
      const body = await response.json()

      if (process.env.NODE_ENV === "development") {
        console.log("[expenses/edit] loadData", {
          expenseId,
          businessId: business.id,
          status: response.status,
          ok: response.ok,
          error: body?.error,
          hasExpense: !!body?.expense,
        })
      }

      if (!response.ok) {
        if (response.status === 404) {
          setError("Expense not found")
        } else {
          setError(body?.error || "Failed to load expense")
        }
        setLoadingData(false)
        return
      }

      const expense = body.expense
      if (!expense) {
        setError("Expense not found")
        setLoadingData(false)
        return
      }
      
      setSupplier(expense.supplier || "")
      setCategoryId(expense.category_id || "")
      // Display the total (including taxes) in the amount field
      setAmount(expense.total?.toString() || expense.amount?.toString() || "")
      setDate(expense.date || new Date().toISOString().split("T")[0])
      setNotes(expense.notes || "")
      setExistingReceiptPath(expense.receipt_path)
      if (expense.receipt_path) {
        setReceiptPreview(expense.receipt_path)
      } else {
        setReceiptPreview(null)
      }
      setRemoveReceipt(false) // Reset remove flag when loading
      setReceiptFile(null) // Reset file selection when loading
      
      // Check if taxes were applied
      const hasTaxes = Number(expense.nhil || 0) + Number(expense.getfund || 0) + Number(expense.covid || 0) + Number(expense.vat || 0) > 0
      setApplyTaxes(hasTaxes)
      
      setLoadingData(false)
    } catch (err: any) {
      setError(err.message || "Failed to load data")
      setLoadingData(false)
    }
  }

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCategoryName.trim() || !businessId) return

    try {
      setCreatingCategory(true)
      const response = await fetch("/api/expense-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          name: newCategoryName.trim(),
          description: newCategoryDescription.trim() || null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to create category")
      }

      const { category } = await response.json()
      
      // Refresh categories list
      const { data: categoriesData } = await supabase
        .from("expense_categories")
        .select("id, name")
        .eq("business_id", businessId)
        .order("is_default", { ascending: false }) // Defaults first
        .order("name", { ascending: true })

      setCategories(categoriesData || [])
      
      // Auto-select the newly created category
      setCategoryId(category.id)
      
      // Close modal and reset form
      setShowCategoryModal(false)
      setNewCategoryName("")
      setNewCategoryDescription("")
      setCreatingCategory(false)
    } catch (err: any) {
      setError(err.message || "Failed to create category")
      setCreatingCategory(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setReceiptFile(file)
      setRemoveReceipt(false) // If user selects a new file, clear the remove flag
      // Create preview for images
      if (file.type.startsWith("image/")) {
        const reader = new FileReader()
        reader.onloadend = () => {
          setReceiptPreview(reader.result as string)
        }
        reader.readAsDataURL(file)
      } else {
        setReceiptPreview(null)
      }
    }
  }

  const handleRemoveReceipt = () => {
    setReceiptFile(null)
    setReceiptPreview(null)
    setRemoveReceipt(true)
    // Clear file input
    const fileInput = document.getElementById('receipt-file-input') as HTMLInputElement
    if (fileInput) {
      fileInput.value = ''
    }
  }

  const uploadReceipt = async (): Promise<string | null> => {
    if (!receiptFile || !businessId) {
      return null
    }

    try {
      // Use standardized file handling utility
      const storagePath = generateStoragePath("expenses", businessId, receiptFile.name, expenseId)
      const result = await uploadFileToStorage(
        supabase,
        "receipts",
        receiptFile,
        storagePath,
        {
          originalFilename: receiptFile.name,
          mimeType: receiptFile.type,
          size: receiptFile.size,
        }
      )

      if (!result.success) {
        throw new Error(result.error || "Failed to upload file")
      }

      return result.publicUrl
    } catch (err: any) {
      console.error("Error uploading receipt:", err)
      throw err
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!supplier.trim()) {
      setError("Supplier name is required")
      return
    }

    if (!amount || Number(amount) <= 0) {
      setError("Amount must be greater than 0")
      return
    }

    try {
      setLoading(true)

      // Calculate taxes if applicable
      // The amount field represents the TOTAL including taxes
      const totalIncludingTaxes = Number(amount)
      
      let baseAmount = totalIncludingTaxes
      let taxBreakdown = {
        nhil: 0,
        getfund: 0,
        covid: 0,
        vat: 0,
        totalTax: 0,
      }

      if (applyTaxes) {
        // Calculate base amount from total including taxes
        const result = calculateBaseFromTotalIncludingTaxes(totalIncludingTaxes, true)
        baseAmount = result.baseAmount
        taxBreakdown = {
          nhil: result.taxBreakdown.nhil,
          getfund: result.taxBreakdown.getfund,
          covid: result.taxBreakdown.covid,
          vat: result.taxBreakdown.vat,
          totalTax: result.taxBreakdown.totalTax,
        }
      }

      const total = totalIncludingTaxes // Total is what user entered

      // Handle receipt upload/removal/preservation
      let receiptPath: string | null | undefined = undefined // undefined = preserve existing, null = remove, string = new path
      
      if (removeReceipt) {
        // User explicitly wants to remove receipt
        receiptPath = null
      } else if (receiptFile) {
        // New file is being uploaded
        try {
          const uploadedPath = await uploadReceipt()
          receiptPath = uploadedPath
        } catch (uploadErr) {
          setError("Failed to upload receipt file. Please try again.")
          setLoading(false)
          return
        }
      }
      // If neither removeReceipt nor receiptFile, receiptPath remains undefined (preserve existing)

      // Build request body - only include receipt_path if it changed
      const requestBody: any = {
        supplier,
        category_id: categoryId || null,
        amount: baseAmount, // Store base amount (before taxes)
        nhil: taxBreakdown.nhil,
        getfund: taxBreakdown.getfund,
        covid: taxBreakdown.covid,
        vat: taxBreakdown.vat,
        total, // Store total (including taxes, what user entered)
        date,
        notes: notes || null,
      }

      // Only include receipt_path if it changed (not undefined)
      if (receiptPath !== undefined) {
        requestBody.receipt_path = receiptPath
      }

      // Update expense via API
      const response = await fetch(`/api/expenses/${expenseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to update expense")
      }

      router.push(`/service/expenses/${expenseId}/view`)
    } catch (err: any) {
      setError(err.message || "Failed to update expense")
      setLoading(false)
    }
  }

  // Calculate tax breakdown for display
  // The amount field represents the TOTAL including taxes
  const totalIncludingTaxes = Number(amount) || 0
  
  let baseAmount = totalIncludingTaxes
  let taxBreakdown = {
    nhil: 0,
    getfund: 0,
    covid: 0,
    vat: 0,
    totalTax: 0,
  }

  if (applyTaxes && totalIncludingTaxes > 0) {
    // Calculate base amount from total including taxes
    const result = calculateBaseFromTotalIncludingTaxes(totalIncludingTaxes, true)
    baseAmount = result.baseAmount
    taxBreakdown = {
      nhil: result.taxBreakdown.nhil,
      getfund: result.taxBreakdown.getfund,
      covid: result.taxBreakdown.covid,
      vat: result.taxBreakdown.vat,
      totalTax: result.taxBreakdown.totalTax,
    }
  }

  const total = totalIncludingTaxes // Total is what user entered

  if (loadingData) {
    return (
      <Wrapper>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </Wrapper>
    )
  }

  return (
    <Wrapper>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <button
              onClick={() => router.back()}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4 flex items-center gap-2 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
              Edit Expense
            </h1>
            <p className="text-gray-600 dark:text-gray-400">Update expense information</p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Supplier *
                  </label>
                  <input
                    type="text"
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    required
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Supplier name"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Category
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowCategoryModal(true)}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add Category
                    </button>
                  </div>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">Select category</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Amount {applyTaxes ? "(including taxes)" : ""} *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="0.00"
                  />
                  {applyTaxes && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Enter the total amount including all taxes
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Date *
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Additional notes about this expense..."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Receipt (Image/PDF)
                </label>
                {existingReceiptPath && !receiptFile && (
                  <div className={`mb-4 p-4 rounded-lg border ${removeReceipt 
                    ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' 
                    : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600'}`}>
                    {removeReceipt && (
                      <div className="mb-3 p-2 bg-red-100 dark:bg-red-900/30 rounded border border-red-200 dark:border-red-700">
                        <p className="text-sm text-red-800 dark:text-red-200 font-medium">
                          ⚠️ Receipt will be removed when you save
                        </p>
                      </div>
                    )}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Current receipt:</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{extractFilename(existingReceiptPath)}</p>
                      </div>
                      {!removeReceipt && (
                        <button
                          type="button"
                          onClick={handleRemoveReceipt}
                          className="ml-4 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm font-medium"
                        >
                          Remove
                        </button>
                      )}
                      {removeReceipt && (
                        <button
                          type="button"
                          onClick={() => setRemoveReceipt(false)}
                          className="ml-4 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-sm font-medium"
                        >
                          Keep
                        </button>
                      )}
                    </div>
                    <div className={removeReceipt ? 'opacity-60' : ''}>
                      {existingReceiptPath.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                        <div className="mb-2">
                          <img 
                            src={existingReceiptPath} 
                            alt="Current receipt" 
                            className="max-w-xs rounded-lg border border-gray-300 dark:border-gray-600" 
                          />
                        </div>
                      ) : (
                        <div className="mb-2 flex items-center gap-2">
                          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <span className="text-sm text-gray-600 dark:text-gray-400">PDF Document</span>
                        </div>
                      )}
                      <a 
                        href={existingReceiptPath} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="inline-flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download receipt
                      </a>
                    </div>
                  </div>
                )}
                <input
                  id="receipt-file-input"
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleFileChange}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                />
                {receiptPreview && receiptFile && (
                  <div className="mt-4">
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">New receipt preview:</p>
                    <img src={receiptPreview} alt="Receipt preview" className="max-w-xs rounded-lg border border-gray-300 dark:border-gray-600" />
                  </div>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  {existingReceiptPath && !removeReceipt && !receiptFile
                    ? "Upload a new file to replace the current receipt, or click 'Remove' to delete it."
                    : "Optional: Upload an image or PDF receipt for this expense."}
                </p>
              </div>

              <div className="pt-4 border-t border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <label className="text-sm font-medium text-gray-900">
                      Apply Ghana Taxes
                    </label>
                    <p className="text-xs text-gray-500 mt-1">
                      Include NHIL, GETFund, and VAT
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={applyTaxes}
                    onClick={() => setApplyTaxes(!applyTaxes)}
                    className={`
                      relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
                      transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                      ${applyTaxes ? 'bg-blue-600' : 'bg-gray-200'}
                    `}
                  >
                    <span
                      className={`
                        pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0
                        transition duration-200 ease-in-out
                        ${applyTaxes ? 'translate-x-5' : 'translate-x-0'}
                      `}
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* Tax Breakdown */}
            {applyTaxes && totalIncludingTaxes > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Tax Breakdown</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600 dark:text-gray-400">Subtotal (before tax):</span>
                    <span className="font-semibold text-gray-900 dark:text-white">₵{baseAmount.toFixed(2)}</span>
                  </div>
                  <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-600 dark:text-gray-400">NHIL (2.5%):</span>
                      <span className="text-gray-700 dark:text-gray-300">₵{taxBreakdown.nhil.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-600 dark:text-gray-400">GETFund (2.5%):</span>
                      <span className="text-gray-700 dark:text-gray-300">₵{taxBreakdown.getfund.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-600 dark:text-gray-400">VAT (15%):</span>
                      <span className="text-gray-700 dark:text-gray-300">₵{taxBreakdown.vat.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t-2 border-gray-300 dark:border-gray-600">
                    <span className="text-gray-900 dark:text-white font-bold text-lg">Total:</span>
                    <span className="font-bold text-blue-600 dark:text-blue-400 text-xl">₵{total.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}

            {!applyTaxes && totalIncludingTaxes > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
                <div className="flex justify-between items-center">
                  <span className="text-gray-900 dark:text-white font-bold text-lg">Total:</span>
                  <span className="font-bold text-blue-600 dark:text-blue-400 text-xl">₵{totalIncludingTaxes.toFixed(2)}</span>
                </div>
              </div>
            )}

            <div className="flex gap-4 pt-4">
              <button
                type="button"
                onClick={() => router.back()}
                className="flex-1 bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-6 py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 font-medium transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 font-medium shadow-lg transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Updating...
                  </>
                ) : (
                  "Update Expense"
                )}
              </button>
            </div>
          </form>

          {/* Add Category Modal */}
          {showCategoryModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Add New Category</h2>
                <form onSubmit={handleCreateCategory}>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Category Name *
                      </label>
                      <input
                        type="text"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        required
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                        placeholder="e.g., Fuel, Materials, Office Supplies"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Description (optional)
                      </label>
                      <textarea
                        value={newCategoryDescription}
                        onChange={(e) => setNewCategoryDescription(e.target.value)}
                        rows={3}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                        placeholder="Optional description..."
                      />
                    </div>
                  </div>
                  <div className="flex gap-3 mt-6">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCategoryModal(false)
                        setNewCategoryName("")
                        setNewCategoryDescription("")
                      }}
                      className="flex-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={creatingCategory || !newCategoryName.trim()}
                      className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {creatingCategory ? "Creating..." : "Create Category"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </Wrapper>
  )
}

