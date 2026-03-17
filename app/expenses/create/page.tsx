"use client"

import { useState, useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { calculateGhanaTaxes, calculateBaseFromTotalIncludingTaxes } from "@/lib/ghanaTaxEngine"
type ExpenseCategory = {
  id: string
  name: string
}

export default function CreateExpensePage() {
  const router = useRouter()
  const pathname = usePathname()
  const isUnderService = pathname?.startsWith("/service") ?? false
  const Wrapper = isUnderService ? ({ children }: { children: React.ReactNode }) => <>{children}</> : ProtectedLayout
  const [loading, setLoading] = useState(false)
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

  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrError, setOcrError] = useState("")
  const [ocrSuggestedFields, setOcrSuggestedFields] = useState<{ supplier?: boolean; date?: boolean; amount?: boolean }>({})
  
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [newCategoryDescription, setNewCategoryDescription] = useState("")
  const [creatingCategory, setCreatingCategory] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) return

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
    } catch (err: any) {
      setError(err.message || "Failed to load data")
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
      setOcrError("")
      setOcrSuggestedFields({})
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

  const handleExtractFromReceipt = async () => {
    if (!receiptFile || !businessId) return
    const isImage = receiptFile.type.startsWith("image/")
    if (!isImage) {
      setOcrError("OCR is available for image files (JPG, PNG). PDF support may be added later.")
      return
    }
    setOcrError("")
    setOcrLoading(true)
    try {
      const receiptPath = await uploadReceipt()
      if (!receiptPath) {
        setOcrError("Could not upload receipt. Try again.")
        setOcrLoading(false)
        return
      }
      const res = await fetch("/api/receipt-ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          receipt_path: receiptPath,
          document_type: "expense",
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setOcrError(data.error ?? "OCR failed")
        setOcrLoading(false)
        return
      }
      if (!data.ok || !data.suggestions) {
        setOcrError(data.error ?? "Couldn't confidently read this receipt. Please fill manually.")
        setOcrLoading(false)
        return
      }
      const suggestions = data.suggestions
      const conf = data.confidence || {}
      const allLow = Object.keys(conf).length > 0 && Object.values(conf).every((c) => c === "LOW")
      if (allLow) {
        setOcrError("Couldn't confidently read this receipt. Please fill manually.")
      }
      const nextSuggested: { supplier?: boolean; date?: boolean; amount?: boolean } = {}
      if (suggestions.supplier_name != null && String(suggestions.supplier_name).trim()) {
        setSupplier(String(suggestions.supplier_name).trim())
        nextSuggested.supplier = true
      }
      if (suggestions.document_date != null) {
        setDate(String(suggestions.document_date))
        nextSuggested.date = true
      }
      if (suggestions.total != null && Number(suggestions.total) > 0) {
        setAmount(String(suggestions.total))
        nextSuggested.amount = true
      }
      if (suggestions.document_number != null && String(suggestions.document_number).trim()) {
        setNotes((prev) => (prev ? `${prev}\n` : "") + `Ref: ${suggestions.document_number}`)
      }
      setOcrSuggestedFields(nextSuggested)
    } catch (err: any) {
      setOcrError(err.message ?? "OCR failed")
    } finally {
      setOcrLoading(false)
    }
  }

  const uploadReceipt = async (): Promise<string | null> => {
    if (!receiptFile || !businessId) return null

    try {
      const fileExt = receiptFile.name.split(".").pop()
      const fileName = `${businessId}/${Date.now()}.${fileExt}`
      const filePath = `expenses/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(filePath, receiptFile)

      if (uploadError) {
        // Create bucket if it doesn't exist (this would need to be done manually in Supabase)
        console.error("Upload error:", uploadError)
        return null
      }

      const { data: { publicUrl } } = supabase.storage
        .from("receipts")
        .getPublicUrl(filePath)

      return publicUrl
    } catch (err) {
      console.error("Error uploading receipt:", err)
      return null
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

      // Upload receipt if provided
      let receiptPath = null
      if (receiptFile) {
        receiptPath = await uploadReceipt()
      }

      // Create expense via API
      const response = await fetch("/api/expenses/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
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
          receipt_path: receiptPath,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to create expense")
      }

      router.push("/service/expenses")
    } catch (err: any) {
      setError(err.message || "Failed to create expense")
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

  return (
    <Wrapper>
      <div className="bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-3xl mx-auto p-6">
          <div className="mb-6">
            <button
              onClick={() => router.back()}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4 flex items-center gap-2 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Expenses
            </button>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
              Create Expense
            </h1>
            <p className="text-gray-600 dark:text-gray-400">Record a new business expense</p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col" style={{ minHeight: 'calc(100vh - 200px)' }}>
            <div className="overflow-y-auto pr-2 space-y-6 flex-1" style={{ maxHeight: 'calc(100vh - 240px)' }}>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Supplier *
                    {ocrSuggestedFields.supplier && (
                      <span className="ml-2 text-xs font-normal italic text-blue-600 dark:text-blue-400" title="Suggested by receipt OCR">
                        From receipt
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={supplier}
                    onChange={(e) => {
                      setSupplier(e.target.value)
                      setOcrSuggestedFields((prev) => ({ ...prev, supplier: false }))
                    }}
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
                    {ocrSuggestedFields.amount && (
                      <span className="ml-2 text-xs font-normal italic text-blue-600 dark:text-blue-400" title="Suggested by receipt OCR">
                        From receipt
                      </span>
                    )}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value)
                      setOcrSuggestedFields((prev) => ({ ...prev, amount: false }))
                    }}
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
                    {ocrSuggestedFields.date && (
                      <span className="ml-2 text-xs font-normal italic text-blue-600 dark:text-blue-400" title="Suggested by receipt OCR">
                        From receipt
                      </span>
                    )}
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => {
                      setDate(e.target.value)
                      setOcrSuggestedFields((prev) => ({ ...prev, date: false }))
                    }}
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
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleFileChange}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                />
                {receiptPreview && receiptFile?.type.startsWith("image/") && (
                  <div className="mt-3 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleExtractFromReceipt}
                      disabled={ocrLoading}
                      className="inline-flex items-center gap-2 self-start px-4 py-2 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60 disabled:opacity-50 text-sm font-medium"
                    >
                      {ocrLoading ? (
                        <>
                          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Extracting…
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          Extract from receipt
                        </>
                      )}
                    </button>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Pre-fills supplier, date, and amount. You must still click &quot;Create Expense&quot; to save.
                    </p>
                  </div>
                )}
                {ocrError && (
                  <p className="mt-2 text-sm text-amber-600 dark:text-amber-400" role="alert">
                    {ocrError}
                  </p>
                )}
                {receiptPreview && (
                  <div className="mt-4">
                    <img src={receiptPreview} alt="Receipt preview" className="max-w-xs rounded-lg border border-gray-300 dark:border-gray-600" />
                  </div>
                )}
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
            </div>

            {/* Sticky Action Bar */}
            <div className="sticky bottom-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4 flex gap-4 z-20 mt-4 shadow-lg">
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
                    Creating...
                  </>
                ) : (
                  "Create Expense"
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

