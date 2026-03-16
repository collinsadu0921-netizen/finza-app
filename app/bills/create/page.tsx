"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { calculateGhanaTaxesFromLineItems, calculateBaseFromTotalIncludingTaxes } from "@/lib/ghanaTaxEngine"
import { getCurrencySymbol } from "@/lib/currency"
import { resolveCurrencyDisplay } from "@/lib/currency/resolveCurrencyDisplay"
import { normalizeCountry } from "@/lib/payments/eligibility"

type LineItem = {
  id: string
  description: string
  qty: number
  unit_price: number
  discount_amount: number
}

export default function CreateBillPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [supplierName, setSupplierName] = useState("")
  const [supplierPhone, setSupplierPhone] = useState("")
  const [supplierEmail, setSupplierEmail] = useState("")
  const [billNumber, setBillNumber] = useState("")
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split("T")[0])
  const [dueDate, setDueDate] = useState("")
  const [notes, setNotes] = useState("")
  const [items, setItems] = useState<LineItem[]>([
    {
      id: Date.now().toString(),
      description: "",
      qty: 1,
      unit_price: 0,
      discount_amount: 0,
    },
  ])
  const [applyTaxes, setApplyTaxes] = useState(true)
  const [status, setStatus] = useState<"draft" | "open">("draft")
  const [businessCountry, setBusinessCountry] = useState<string | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string>("")
  const [currencyCode, setCurrencyCode] = useState<string>("")

  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [uploadedAttachmentPath, setUploadedAttachmentPath] = useState<string | null>(null)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrError, setOcrError] = useState("")
  const [ocrSuggestions, setOcrSuggestions] = useState<{
    supplier_name?: string
    document_number?: string
    document_date?: string
    subtotal?: number
    total?: number
  } | null>(null)
  const [ocrSuggestedFields, setOcrSuggestedFields] = useState<{
    supplier_name?: boolean
    bill_number?: boolean
    issue_date?: boolean
    subtotal?: boolean
  }>({})

  useEffect(() => {
    loadBusiness()
  }, [])

  const loadBusiness = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) return

      setBusinessId(business.id)
      setBusinessCountry(business.address_country || null)
      
      // CRITICAL: Get currency symbol from currency code
      const businessCurrency = business.default_currency || null
      setCurrencyCode(businessCurrency || "")
      if (businessCurrency) {
        const symbol = getCurrencySymbol(businessCurrency)
        if (symbol) {
          setCurrencySymbol(symbol)
        } else {
          setError("Currency symbol not available. Please set your business currency in Business Profile settings.")
        }
      } else {
        setError("Business currency is required. Please set your business currency in Business Profile settings.")
      }
    } catch (err: any) {
      setError(err.message || "Failed to load business")
    }
  }

  const addItem = () => {
    setItems([
      ...items,
      {
        id: Date.now().toString(),
        description: "",
        qty: 1,
        unit_price: 0,
        discount_amount: 0,
      },
    ])
  }

  const removeItem = (id: string) => {
    if (items.length > 1) {
      setItems(items.filter((item) => item.id !== id))
    }
  }

  const updateItem = (id: string, field: keyof LineItem, value: any) => {
    setItems(
      items.map((item) => {
        if (item.id === id) {
          return { ...item, [field]: value }
        }
        return item
      })
    )
    if (field === "description" || field === "unit_price" || field === "qty") {
      setOcrSuggestedFields((prev) => ({ ...prev, subtotal: false }))
    }
  }

  const handleReceiptFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setReceiptFile(file)
      setOcrError("")
      setOcrSuggestions(null)
      setOcrSuggestedFields({})
      setUploadedAttachmentPath(null)
      if (file.type.startsWith("image/")) {
        const reader = new FileReader()
        reader.onloadend = () => setReceiptPreview(reader.result as string)
        reader.readAsDataURL(file)
      } else {
        setReceiptPreview(null)
      }
    }
  }

  const uploadReceipt = async (): Promise<{ publicUrl: string; storagePath: string } | null> => {
    if (!receiptFile || !businessId) return null
    try {
      const fileExt = receiptFile.name.split(".").pop() || "jpg"
      const storagePath = `bills/${businessId}/${Date.now()}.${fileExt}`
      const { error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(storagePath, receiptFile)
      if (uploadError) {
        console.error("Upload error:", uploadError)
        return null
      }
      const { data: { publicUrl } } = supabase.storage.from("receipts").getPublicUrl(storagePath)
      return { publicUrl, storagePath }
    } catch (err) {
      console.error("Error uploading receipt:", err)
      return null
    }
  }

  const handleExtractFromReceipt = async () => {
    if (!receiptFile || !businessId) return
    if (!receiptFile.type.startsWith("image/")) {
      setOcrError("OCR is available for image files (JPG, PNG). PDF support may be added later.")
      return
    }
    setOcrError("")
    setOcrLoading(true)
    try {
      const uploaded = await uploadReceipt()
      if (!uploaded) {
        setOcrError("Could not upload receipt. Try again.")
        setOcrLoading(false)
        return
      }
      setUploadedAttachmentPath(uploaded.storagePath)
      const res = await fetch("/api/receipt-ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          receipt_path: uploaded.publicUrl,
          document_type: "supplier_bill",
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
      const s = data.suggestions
      setOcrSuggestions(s)
      const conf = data.confidence || {}
      const allLow = Object.keys(conf).length > 0 && Object.values(conf).every((c) => c === "LOW")
      if (allLow) setOcrError("Couldn't confidently read this receipt. Please fill manually.")
      const next: typeof ocrSuggestedFields = {}
      if (s.supplier_name != null && String(s.supplier_name).trim()) {
        setSupplierName(String(s.supplier_name).trim())
        next.supplier_name = true
      }
      if (s.document_number != null && String(s.document_number).trim()) {
        setBillNumber(String(s.document_number).trim())
        next.bill_number = true
      }
      if (s.document_date != null) {
        setIssueDate(String(s.document_date))
        next.issue_date = true
      }
      // Map total → subtotal (tax-exclusive). Use subtotal when OCR provides it, else total as subtotal.
      const subtotalAmount = (s.subtotal != null && Number(s.subtotal) > 0)
        ? Number(s.subtotal)
        : (s.total != null && Number(s.total) > 0 ? Number(s.total) : null)
      if (subtotalAmount != null) {
        setItems([
          {
            id: Date.now().toString(),
            description: "From receipt",
            qty: 1,
            unit_price: subtotalAmount,
            discount_amount: 0,
          },
        ])
        next.subtotal = true
      }
      setOcrSuggestedFields(next)
    } catch (err: any) {
      setOcrError(err.message ?? "OCR failed")
    } finally {
      setOcrLoading(false)
    }
  }

  // Calculate totals
  // For bills, line items represent amounts that INCLUDE taxes (like expenses)
  const subtotalIncludingTaxes = items.reduce((sum, item) => {
    const lineTotal = (Number(item.qty) || 0) * (Number(item.unit_price) || 0)
    const discount = Number(item.discount_amount) || 0
    return sum + lineTotal - discount
  }, 0)

  const taxResult = applyTaxes
    ? (() => {
        // Reverse-calculate: total includes taxes, so extract base amount
        const { baseAmount, taxBreakdown } = calculateBaseFromTotalIncludingTaxes(
          subtotalIncludingTaxes,
          true
        )
        return {
          subtotalBeforeTax: baseAmount,
          nhil: taxBreakdown.nhil,
          getfund: taxBreakdown.getfund,
          covid: taxBreakdown.covid,
          vat: taxBreakdown.vat,
          totalTax: taxBreakdown.totalTax,
          grandTotal: subtotalIncludingTaxes, // Total stays the same (includes taxes)
        }
      })()
    : {
        subtotalBeforeTax: subtotalIncludingTaxes,
        nhil: 0,
        getfund: 0,
        covid: 0,
        vat: 0,
        totalTax: 0,
        grandTotal: subtotalIncludingTaxes,
      }

  const currency = resolveCurrencyDisplay({ currency_symbol: currencySymbol, currency_code: currencyCode })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!businessId) {
      setError("Business information not loaded. Please refresh the page.")
      return
    }

    if (!supplierName.trim()) {
      setError("Supplier name is required")
      return
    }

    if (!billNumber.trim()) {
      setError("Bill number is required")
      return
    }

    if (items.length === 0) {
      setError("Please add at least one item")
      return
    }

    // Validate items
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item.description.trim()) {
        setError(`Item ${i + 1}: Description is required`)
        return
      }
      if (Number(item.qty) <= 0) {
        setError(`Item ${i + 1}: Quantity must be greater than 0`)
        return
      }
      if (Number(item.unit_price) < 0) {
        setError(`Item ${i + 1}: Unit price cannot be negative`)
        return
      }
    }

    try {
      setLoading(true)

      let attachmentPath: string | null = uploadedAttachmentPath
      if (!attachmentPath && receiptFile) {
        const uploaded = await uploadReceipt()
        attachmentPath = uploaded ? uploaded.storagePath : null
      }

      const response = await fetch("/api/bills/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          supplier_name: supplierName.trim(),
          supplier_phone: supplierPhone.trim() || null,
          supplier_email: supplierEmail.trim() || null,
          bill_number: billNumber.trim(),
          issue_date: issueDate,
          due_date: dueDate || null,
          notes: notes.trim() || null,
          apply_taxes: applyTaxes,
          status,
          attachment_path: attachmentPath || null,
          items: items.map((item) => ({
            description: item.description,
            qty: item.qty,
            unit_price: item.unit_price,
            discount_amount: item.discount_amount,
          })),
        }),
      })

      const responseData = await response.json()
      
      if (!response.ok) {
        setError(responseData.error || "Failed to create bill")
        setLoading(false)
        return
      }

      if (!responseData.bill || !responseData.bill.id) {
        setError("Bill was created but no ID was returned. Please check the bills list.")
        setLoading(false)
        return
      }

      router.push(`/bills/${responseData.bill.id}/view`)
    } catch (err: any) {
      setError(err.message || "Failed to create bill")
      setLoading(false)
    }
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
            <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent mb-2">
              Create Supplier Bill
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-lg">Record a new bill from a supplier</p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Supplier Info */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Supplier Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Supplier Name *
                    {ocrSuggestedFields.supplier_name && (
                      <span className="ml-2 text-xs font-normal italic text-purple-600 dark:text-purple-400" title="Suggested by receipt OCR">
                        From receipt
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={supplierName}
                    onChange={(e) => {
                      setSupplierName(e.target.value)
                      setOcrSuggestedFields((prev) => ({ ...prev, supplier_name: false }))
                    }}
                    required
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Supplier company name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Bill Number *
                    {ocrSuggestedFields.bill_number && (
                      <span className="ml-2 text-xs font-normal italic text-purple-600 dark:text-purple-400" title="Suggested by receipt OCR">
                        From receipt
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={billNumber}
                    onChange={(e) => {
                      setBillNumber(e.target.value)
                      setOcrSuggestedFields((prev) => ({ ...prev, bill_number: false }))
                    }}
                    required
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Bill/Invoice number from supplier"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Supplier Phone (WhatsApp)
                  </label>
                  <input
                    type="tel"
                    value={supplierPhone}
                    onChange={(e) => setSupplierPhone(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
                    placeholder="+233..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Supplier Email
                  </label>
                  <input
                    type="email"
                    value={supplierEmail}
                    onChange={(e) => setSupplierEmail(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
                    placeholder="supplier@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Issue Date *
                    {ocrSuggestedFields.issue_date && (
                      <span className="ml-2 text-xs font-normal italic text-purple-600 dark:text-purple-400" title="Suggested by receipt OCR">
                        From receipt
                      </span>
                    )}
                  </label>
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(e) => {
                      setIssueDate(e.target.value)
                      setOcrSuggestedFields((prev) => ({ ...prev, issue_date: false }))
                    }}
                    required
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
              </div>
              <div className="mt-4">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Additional notes about this bill"
                />
              </div>

              <div className="mt-4">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Receipt (Image/PDF)
                </label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleReceiptFileChange}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
                />
                {receiptPreview && receiptFile?.type.startsWith("image/") && (
                  <div className="mt-3 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleExtractFromReceipt}
                      disabled={ocrLoading}
                      className="inline-flex items-center gap-2 self-start px-4 py-2 rounded-lg bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60 disabled:opacity-50 text-sm font-medium"
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
                      Pre-fills supplier, bill number, date, and total. You must still click &quot;Create Bill&quot; to save.
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
            </div>

            {/* Items */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  Bill Items
                  {ocrSuggestedFields.subtotal && (
                    <span className="ml-2 text-xs font-normal italic text-purple-600 dark:text-purple-400" title="Subtotal from receipt OCR">
                      From receipt
                    </span>
                  )}
                </h2>
                <button
                  type="button"
                  onClick={addItem}
                  className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 font-medium text-sm transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Item
                </button>
              </div>

              <div className="space-y-4">
                {items.map((item) => (
                  <div key={item.id} className="grid grid-cols-12 gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <div className="col-span-12 md:col-span-5">
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Description</label>
                      <input
                        type="text"
                        value={item.description}
                        onChange={(e) => updateItem(item.id, "description", e.target.value)}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
                        required
                      />
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Qty</label>
                      <input
                        type="number"
                        value={item.qty}
                        onChange={(e) => updateItem(item.id, "qty", Number(e.target.value) || 0)}
                        min="0"
                        step="0.01"
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
                        required
                      />
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Unit Price</label>
                      <input
                        type="number"
                        value={item.unit_price}
                        onChange={(e) => updateItem(item.id, "unit_price", Number(e.target.value) || 0)}
                        min="0"
                        step="0.01"
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
                        required
                      />
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Discount</label>
                      <input
                        type="number"
                        value={item.discount_amount}
                        onChange={(e) => updateItem(item.id, "discount_amount", Number(e.target.value) || 0)}
                        min="0"
                        step="0.01"
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                    <div className="col-span-12 md:col-span-1 flex items-end">
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 p-2"
                        disabled={items.length === 1}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Tax Toggle */}
              <div className="mt-6 pt-6 border-t border-gray-200">
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

              {/* Totals Preview */}
              <div className="mt-6 pt-6 border-t-2 border-gray-300 dark:border-gray-600">
                <div className="flex justify-end">
                  <div className="w-72 space-y-3 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-lg p-5 border border-purple-200 dark:border-purple-700">
                    <div className="flex justify-between items-center">
                      <span className="text-purple-900 dark:text-purple-300 font-medium">
                        {applyTaxes ? "Subtotal (before tax):" : "Subtotal:"}
                      </span>
                      <span className="font-semibold text-purple-900 dark:text-purple-300 text-lg">{currency}{Number(taxResult.subtotalBeforeTax ?? 0).toFixed(2)}</span>
                    </div>
                    {applyTaxes && (() => {
                      const countryCode = businessCountry ? normalizeCountry(businessCountry) : null
                      const isGhana = countryCode === "GH"
                      
                      // CRITICAL: Only show Ghana tax labels for GH businesses
                      if (isGhana) {
                        return (
                          <>
                            <div className="space-y-1 pt-2 border-t border-purple-200 dark:border-purple-500">
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-purple-800 dark:text-purple-400">NHIL (2.5%):</span>
                                <span className="text-purple-900 dark:text-purple-300">{currency}{Number(taxResult.nhil ?? 0).toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-purple-800 dark:text-purple-400">GETFund (2.5%):</span>
                                <span className="text-purple-900 dark:text-purple-300">{currency}{Number(taxResult.getfund ?? 0).toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-purple-800 dark:text-purple-400">VAT (15%):</span>
                                <span className="text-purple-900 dark:text-purple-300">{currency}{Number(taxResult.vat ?? 0).toFixed(2)}</span>
                              </div>
                            </div>
                            <div className="flex justify-between items-center pt-2 border-t border-purple-200 dark:border-purple-500">
                              <span className="text-purple-900 dark:text-purple-300 font-medium">Total Tax:</span>
                              <span className="font-semibold text-purple-900 dark:text-purple-300">{currency}{Number(taxResult.totalTax ?? 0).toFixed(2)}</span>
                            </div>
                          </>
                        )
                      } else {
                        // Non-GH: Show generic VAT only
                        return (
                          <div className="space-y-1 pt-2 border-t border-purple-200 dark:border-purple-500">
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-purple-800 dark:text-purple-400">VAT:</span>
                              <span className="text-purple-900 dark:text-purple-300">{currency}{Number(taxResult.vat ?? 0).toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between items-center pt-2 border-t border-purple-200 dark:border-purple-500">
                              <span className="text-purple-900 dark:text-purple-300 font-medium">Total Tax:</span>
                              <span className="font-semibold text-purple-900 dark:text-purple-300">{currency}{Number(taxResult.totalTax ?? 0).toFixed(2)}</span>
                            </div>
                          </div>
                        )
                      }
                    })()}
                    <div className="flex justify-between items-center pt-3 border-t-2 border-purple-300 dark:border-purple-500">
                      <span className="text-purple-900 dark:text-purple-300 font-bold text-lg">Total:</span>
                      <span className="font-bold text-purple-600 dark:text-purple-400 text-xl">{currency}{Number(taxResult.grandTotal ?? 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Status */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Status</h2>
              <div className="flex gap-4">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    name="status"
                    value="draft"
                    checked={status === "draft"}
                    onChange={(e) => setStatus(e.target.value as "draft" | "open")}
                    className="w-4 h-4 text-purple-600 border-gray-300 focus:ring-purple-500"
                  />
                  <span className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">Save as Draft</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    name="status"
                    value="open"
                    checked={status === "open"}
                    onChange={(e) => setStatus(e.target.value as "draft" | "open")}
                    className="w-4 h-4 text-purple-600 border-gray-300 focus:ring-purple-500"
                  />
                  <span className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">Mark as Open</span>
                </label>
              </div>
            </div>

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
                className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 text-white px-6 py-3 rounded-lg hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 font-medium shadow-lg transition-all flex items-center justify-center gap-2"
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
                  "Create Bill"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ProtectedLayout>
  )
}

