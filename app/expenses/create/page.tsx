"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"

const FragmentWrapper = ({ children }: { children: React.ReactNode }) => <>{children}</>
import { getCurrentBusiness } from "@/lib/business"
import { calculateGhanaTaxes, calculateBaseFromTotalIncludingTaxes } from "@/lib/ghanaTaxEngine"
import { getCurrencySymbol } from "@/lib/currency"
import { readApiJson } from "@/lib/readApiJson"
import { NativeSelect } from "@/components/ui/NativeSelect"

type ExpenseCategory = {
  id: string
  name: string
}

export default function CreateExpensePage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isUnderService = pathname?.startsWith("/service") ?? false
  const Wrapper = isUnderService ? FragmentWrapper : ProtectedLayout
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
  const [uploadedReceiptPath, setUploadedReceiptPath] = useState<string | null>(null)
  const [incomingDocumentId, setIncomingDocumentId] = useState<string | null>(null)

  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [newCategoryDescription, setNewCategoryDescription] = useState("")
  const [creatingCategory, setCreatingCategory] = useState(false)

  // Currency state
  const [currencyCode, setCurrencyCode] = useState<string>("")

  // FX (foreign currency) settings
  const [fxEnabled, setFxEnabled] = useState(false)
  const [fxCurrencyCode, setFxCurrencyCode] = useState<string>("USD")
  const [fxRate, setFxRate] = useState<string>("")

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    const ds = searchParams.get("draft_supplier")
    if (ds) setSupplier(ds)
    const da = searchParams.get("draft_amount")
    if (da) setAmount(da)
    const dn = searchParams.get("draft_notes")
    if (dn) setNotes(dn)
    const dd = searchParams.get("draft_date")
    if (dd && /^\d{4}-\d{2}-\d{2}$/.test(dd)) setDate(dd)
  }, [searchParams])

  const incomingPrefillKeyRef = useRef<string>("")
  useEffect(() => {
    const fid = searchParams.get("from_incoming_doc")?.trim()
    if (!fid || !businessId) return
    const dedupeKey = `${businessId}:${fid}`
    if (incomingPrefillKeyRef.current === dedupeKey) return
    incomingPrefillKeyRef.current = dedupeKey
    let cancelled = false
    ;(async () => {
      const res = await fetch(
        `/api/incoming-documents/${encodeURIComponent(fid)}/effective-fields?business_id=${encodeURIComponent(businessId)}`
      )
      const j = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (cancelled || !res.ok || !j || typeof j.effective_fields !== "object" || j.effective_fields === null) return
      const ef = j.effective_fields as Record<string, unknown>
      setIncomingDocumentId(fid)
      if (typeof ef.supplier_name === "string" && ef.supplier_name.trim()) {
        setSupplier(ef.supplier_name.trim())
        setOcrSuggestedFields((p) => ({ ...p, supplier: true }))
      }
      if (ef.document_date != null && String(ef.document_date).trim()) {
        setDate(String(ef.document_date))
        setOcrSuggestedFields((p) => ({ ...p, date: true }))
      }
      if (ef.total != null && Number(ef.total) > 0) {
        setAmount(String(ef.total))
        setOcrSuggestedFields((p) => ({ ...p, amount: true }))
      }
      if (typeof ef.document_number === "string" && ef.document_number.trim()) {
        const bit = `Ref: ${ef.document_number.trim()}`
        setNotes((prev) => (prev?.includes(bit) ? prev : (prev ? `${prev}\n` : "") + bit))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [businessId, searchParams])

  const loadData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) return

      setBusinessId(business.id)

      // Load business currency
      const { data: bizDetails } = await supabase
        .from("businesses")
        .select("default_currency")
        .eq("id", business.id)
        .single()
      if (bizDetails?.default_currency) {
        setCurrencyCode(bizDetails.default_currency)
      }

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
      setIncomingDocumentId(null)
      setOcrError("")
      setOcrSuggestedFields({})
      if (file.type.startsWith("image/")) {
        setReceiptPreview((prev) => {
          if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev)
          return null
        })
        const reader = new FileReader()
        reader.onloadend = () => {
          setReceiptPreview(reader.result as string)
        }
        reader.readAsDataURL(file)
      } else if (file.type === "application/pdf") {
        setReceiptPreview((prev) => {
          if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev)
          return URL.createObjectURL(file)
        })
      } else {
        setReceiptPreview((prev) => {
          if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev)
          return null
        })
      }
    }
  }

  const handleExtractFromReceipt = async () => {
    if (!receiptFile || !businessId) return
    const canExtract =
      receiptFile.type.startsWith("image/") || receiptFile.type === "application/pdf"
    if (!canExtract) {
      setOcrError("Use a JPG, PNG, WebP, or PDF receipt file.")
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
      setUploadedReceiptPath(receiptPath)

      const reg = await fetch("/api/incoming-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          storage_bucket: "receipts",
          storage_path: receiptPath,
          source_type: "expense_form_upload",
          document_kind: "expense_receipt",
          file_name: receiptFile?.name ?? null,
          mime_type: receiptFile?.type ?? null,
          file_size: receiptFile?.size ?? null,
        }),
      })
      const regParsed = await readApiJson<{ document_id?: string; error?: string }>(reg)
      if (!regParsed.ok) {
        setOcrError("Could not register receipt document (invalid response).")
        setOcrLoading(false)
        return
      }
      if (!reg.ok) {
        setOcrError(regParsed.data?.error || "Could not register receipt document.")
        setOcrLoading(false)
        return
      }
      const docId = regParsed.data?.document_id
      if (!docId) {
        setOcrError("Could not register receipt document.")
        setOcrLoading(false)
        return
      }
      setIncomingDocumentId(docId)

      const res = await fetch("/api/receipt-ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          document_id: docId,
          document_type: "expense",
        }),
      })
      const parsed = await readApiJson<{
        ok?: boolean
        error?: string
        suggestions?: Record<string, unknown>
        confidence?: Record<string, string>
      }>(res)
      if (!parsed.ok) {
        const looksLikeHtml = /An error occurred|<!DOCTYPE/i.test(parsed.snippet)
        setOcrError(
          looksLikeHtml
            ? "Receipt scan failed: the server returned an error page (often OCR timeout or crash on serverless). Try a smaller/clearer image, add RECEIPT_OCR_USE_STUB=true in .env.local to test without OCR, or fill the form manually."
            : `Receipt scan failed (${parsed.snippet || "invalid response"}). Try again or fill manually.`
        )
        setOcrLoading(false)
        return
      }
      const data = parsed.data
      if (!res.ok) {
        setOcrError(typeof data.error === "string" ? data.error : "OCR failed")
        setOcrLoading(false)
        return
      }
      if (!data.ok || !data.suggestions) {
        setOcrError(
          typeof data.error === "string"
            ? data.error
            : "Couldn't confidently read this receipt. Please fill manually."
        )
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

      return filePath
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

    if (fxEnabled && fxCurrencyCode && (!fxRate || parseFloat(fxRate) <= 0)) {
      setError(`Exchange rate is required for ${fxCurrencyCode} expenses. Please enter the current rate.`)
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

      // Upload receipt if provided (reuse path from OCR extract if already uploaded)
      let receiptPath = uploadedReceiptPath ?? null
      if (!receiptPath && receiptFile) {
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
          ...(incomingDocumentId ? { incoming_document_id: incomingDocumentId } : {}),
          ...(fxEnabled && fxCurrencyCode && fxRate ? {
            currency_code: fxCurrencyCode,
            fx_rate: parseFloat(fxRate),
          } : {}),
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

  const homeCurrencyCode = currencyCode || ""
  const documentCurrencyCode = fxEnabled && fxCurrencyCode ? fxCurrencyCode : homeCurrencyCode
  const docSymbol = getCurrencySymbol(documentCurrencyCode) || documentCurrencyCode || "₵"
  const homeSymbol = getCurrencySymbol(homeCurrencyCode) || homeCurrencyCode || "₵"
  const fxRateNum = fxRate && !Number.isNaN(parseFloat(fxRate)) ? parseFloat(fxRate) : 0
  const approxHomeTotal =
    fxEnabled && fxRateNum > 0 && documentCurrencyCode && documentCurrencyCode !== homeCurrencyCode
      ? Math.round(totalIncludingTaxes * fxRateNum * 100) / 100
      : null

  return (
    <Wrapper>
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-3xl mx-auto p-6">
          <div className="mb-6">
            <button
              onClick={() => router.back()}
              className="text-slate-500 hover:text-slate-800 flex items-center gap-2 transition-colors mb-4"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Expenses
            </button>
            <h1 className="text-xl font-bold text-slate-900 mb-1">
              Create Expense
            </h1>
            <p className="text-sm text-slate-500">Record a new business expense</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-4 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col" style={{ minHeight: 'calc(100vh - 200px)' }}>
            <div className="overflow-y-auto pr-2 space-y-6 flex-1" style={{ maxHeight: 'calc(100vh - 240px)' }}>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Supplier *
                    {ocrSuggestedFields.supplier && (
                      <span className="text-xs font-medium text-emerald-600 ml-2" title="Suggested by receipt OCR">
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
                    className="border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-slate-100 focus:border-slate-400 w-full"
                    placeholder="Supplier name"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-semibold text-slate-700">
                      Category
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowCategoryModal(true)}
                      className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add Category
                    </button>
                  </div>
                  <NativeSelect
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    size="md"
                  >
                    <option value="">Select category</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Amount {applyTaxes ? "(including taxes)" : ""}
                    {fxEnabled && fxCurrencyCode ? ` (${fxCurrencyCode})` : ""} *
                    {ocrSuggestedFields.amount && (
                      <span className="text-xs font-medium text-emerald-600 ml-2" title="Suggested by receipt OCR">
                        From receipt
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value)
                      setOcrSuggestedFields((prev) => ({ ...prev, amount: false }))
                    }}
                    onFocus={(e) => e.target.select()}
                    required
                    className="border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-slate-100 focus:border-slate-400 w-full"
                    placeholder="0.00"
                  />
                  {applyTaxes && (
                    <p className="text-xs text-slate-500 mt-1">
                      Enter the total amount including all taxes
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Date *
                    {ocrSuggestedFields.date && (
                      <span className="text-xs font-medium text-emerald-600 ml-2" title="Suggested by receipt OCR">
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
                    className="border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-slate-100 focus:border-slate-400 w-full"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-slate-100 focus:border-slate-400 w-full"
                  placeholder="Additional notes about this expense..."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Receipt (Image/PDF)
                </label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleFileChange}
                  className="border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-slate-100 focus:border-slate-400 w-full"
                />
                {receiptFile &&
                  (receiptFile.type.startsWith("image/") || receiptFile.type === "application/pdf") && (
                  <div className="mt-3 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleExtractFromReceipt}
                      disabled={ocrLoading}
                      className="inline-flex items-center gap-2 self-start px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 text-sm font-medium"
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
                    <p className="text-xs text-slate-500">
                      Pre-fills supplier, date, and amount. You must still click &quot;Create Expense&quot; to save.
                    </p>
                    {incomingDocumentId && businessId && (
                      <p className="text-xs text-slate-600">
                        <a
                          className="text-blue-700 underline"
                          href={`/service/incoming-documents/${encodeURIComponent(incomingDocumentId)}/review?business_id=${encodeURIComponent(businessId)}`}
                        >
                          Review and correct extraction
                        </a>
                      </p>
                    )}
                  </div>
                )}
                {ocrError && (
                  <p className="mt-2 text-sm text-amber-600" role="alert">
                    {ocrError}
                  </p>
                )}
                {receiptPreview && receiptFile?.type.startsWith("image/") && (
                  <div className="mt-4">
                    <img src={receiptPreview} alt="Receipt preview" className="max-w-xs rounded-xl border border-slate-200" />
                  </div>
                )}
                {receiptPreview && receiptFile?.type === "application/pdf" && (
                  <div className="mt-4 h-64 w-full max-w-md rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
                    <iframe title="Receipt PDF preview" src={receiptPreview} className="w-full h-full" />
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <label className="text-sm font-medium text-slate-800">
                      Apply Ghana Taxes
                    </label>
                    <p className="text-xs text-slate-500 mt-1">
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
                      ${applyTaxes ? 'bg-slate-800' : 'bg-slate-200'}
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

              {/* FX Currency Section */}
              <div className="border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <label className="text-sm font-medium text-slate-800">
                      Paid in foreign currency?
                    </label>
                    <p className="text-xs text-slate-500 mt-1">
                      Expense was paid in USD, EUR, GBP, etc. — booked in {currencyCode || "home currency"}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={fxEnabled}
                    onClick={() => setFxEnabled(!fxEnabled)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${fxEnabled ? "bg-slate-800" : "bg-slate-200"}`}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${fxEnabled ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </div>
                {fxEnabled && (
                  <div className="mt-3 grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Expense Currency</label>
                      <NativeSelect
                        value={fxCurrencyCode}
                        onChange={(e) => setFxCurrencyCode(e.target.value)}
                        size="sm"
                      >
                        <option value="USD">USD — US Dollar</option>
                        <option value="EUR">EUR — Euro</option>
                        <option value="GBP">GBP — British Pound</option>
                        <option value="KES">KES — Kenyan Shilling</option>
                        <option value="NGN">NGN — Nigerian Naira</option>
                        <option value="ZAR">ZAR — South African Rand</option>
                        <option value="CNY">CNY — Chinese Yuan</option>
                        <option value="INR">INR — Indian Rupee</option>
                      </NativeSelect>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                        Rate: 1 {fxCurrencyCode} = ? {currencyCode || "home"}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={fxRate}
                        onChange={(e) => setFxRate(e.target.value)}
                        placeholder="e.g. 14.50"
                        className="w-full border border-slate-200 text-sm rounded-md p-2 focus:ring-2 focus:ring-slate-100 focus:border-slate-400"
                      />
                    </div>
                    {fxRate && !isNaN(parseFloat(fxRate)) && parseFloat(fxRate) > 0 && (
                      <p className="col-span-2 text-xs text-slate-600">
                        Amount entered in {fxCurrencyCode}. Booked in {currencyCode} at rate {parseFloat(fxRate).toFixed(4)}.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Tax Breakdown */}
            {applyTaxes && totalIncludingTaxes > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Tax Breakdown</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Subtotal (before tax):</span>
                    <span className="font-semibold text-slate-800">{docSymbol}{baseAmount.toFixed(2)}</span>
                  </div>
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-500">NHIL (2.5%):</span>
                      <span className="text-slate-600">{docSymbol}{taxBreakdown.nhil.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-500">GETFund (2.5%):</span>
                      <span className="text-slate-600">{docSymbol}{taxBreakdown.getfund.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-500">VAT (15%):</span>
                      <span className="text-slate-600">{docSymbol}{taxBreakdown.vat.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t-2 border-slate-800">
                    <span className="text-slate-800 font-bold text-lg">Total:</span>
                    <span className="font-bold text-slate-900 text-xl">{docSymbol}{total.toFixed(2)}</span>
                  </div>
                  {approxHomeTotal != null && (
                    <p className="text-xs text-slate-500 mt-2">
                      Booked in {homeCurrencyCode}: ≈ {homeSymbol}{approxHomeTotal.toFixed(2)} (at rate {fxRateNum.toFixed(4)})
                    </p>
                  )}
                </div>
              </div>
            )}

            {!applyTaxes && totalIncludingTaxes > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <div className="flex justify-between items-center">
                  <span className="text-slate-800 font-bold text-lg">Total:</span>
                  <span className="font-bold text-slate-900 text-xl">{docSymbol}{totalIncludingTaxes.toFixed(2)}</span>
                </div>
                {approxHomeTotal != null && (
                  <p className="text-xs text-slate-500 mt-2">
                    Booked in {homeCurrencyCode}: ≈ {homeSymbol}{approxHomeTotal.toFixed(2)} (at rate {fxRateNum.toFixed(4)})
                  </p>
                )}
              </div>
            )}
            </div>

            {/* Sticky Action Bar */}
            <div className="sticky bottom-0 bg-slate-50 border-t border-slate-100 p-4 flex gap-4 z-20 mt-4">
              <button
                type="button"
                onClick={() => router.back()}
                className="flex-1 border border-slate-200 text-slate-700 px-6 py-3 rounded-lg hover:bg-slate-50 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-slate-800 text-white px-6 py-3 rounded-lg hover:bg-slate-700 disabled:opacity-50 font-semibold transition-colors flex items-center justify-center gap-2"
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
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6">
                <h2 className="text-xl font-bold text-slate-900 mb-4">Add New Category</h2>
                <form onSubmit={handleCreateCategory}>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Category Name *
                      </label>
                      <input
                        type="text"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        required
                        className="border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-slate-100 focus:border-slate-400 w-full"
                        placeholder="e.g., Fuel, Materials, Office Supplies"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Description (optional)
                      </label>
                      <textarea
                        value={newCategoryDescription}
                        onChange={(e) => setNewCategoryDescription(e.target.value)}
                        rows={3}
                        className="border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-slate-100 focus:border-slate-400 w-full"
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
                      className="flex-1 border border-slate-200 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={creatingCategory || !newCategoryName.trim()}
                      className="flex-1 bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors"
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

