"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { calculateGhanaTaxes, calculateGhanaTaxesFromLineItems, calculateBaseFromTotalIncludingTaxes } from "@/lib/ghanaTaxEngine"
import { getCurrencySymbol } from "@/lib/currency"
import { resolveCurrencyDisplay } from "@/lib/currency/resolveCurrencyDisplay"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { GH_WHT_RATES, calculateWHT } from "@/lib/wht"

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
  const [applyWHT, setApplyWHT] = useState(false)
  const [whtRateCode, setWhtRateCode] = useState("GH_SVC_5")
  const [status, setStatus] = useState<"draft" | "open">("draft")
  const [businessCountry, setBusinessCountry] = useState<string | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string>("")
  const [currencyCode, setCurrencyCode] = useState<string>("")

  // FX (foreign currency) settings
  const [fxEnabled, setFxEnabled] = useState(false)
  const [fxCurrencyCode, setFxCurrencyCode] = useState<string>("USD")
  const [fxRate, setFxRate] = useState<string>("")

  const displaySymbol = fxEnabled && fxCurrencyCode
    ? (getCurrencySymbol(fxCurrencyCode) || fxCurrencyCode)
    : currencySymbol

  // Import bill state
  const [isImportBill, setIsImportBill] = useState(false)
  const [importDescription, setImportDescription] = useState("")
  const [cifValue, setCifValue] = useState("")
  const [importDutyRate, setImportDutyRate] = useState(0.20)
  const [ecowasLevy, setEcowasLevy] = useState("")
  const [auLevy, setAuLevy] = useState("")
  const [eximLevy, setEximLevy] = useState("")
  const [silLevy, setSilLevy] = useState("")
  const [examinationFee, setExaminationFee] = useState("")
  const [clearingAgentFee, setClearingAgentFee] = useState("")
  const [landedCostAccount, setLandedCostAccount] = useState("5200")
  const [importLeviesManual, setImportLeviesManual] = useState(false)

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

  const currency = fxEnabled && fxCurrencyCode
    ? (getCurrencySymbol(fxCurrencyCode) || fxCurrencyCode)
    : resolveCurrencyDisplay({ currency_symbol: currencySymbol, currency_code: currencyCode })

  // Import bill calculations
  const cifNum   = Number(cifValue) || 0
  const dutyAmt  = Math.round(cifNum * importDutyRate * 100) / 100
  // Auto-calculate levies from CIF unless manually overridden
  const ecowasAmt    = importLeviesManual ? (Number(ecowasLevy) || 0) : Math.round(cifNum * 0.005 * 100) / 100
  const auAmt        = importLeviesManual ? (Number(auLevy) || 0)    : Math.round(cifNum * 0.002 * 100) / 100
  const eximAmt      = importLeviesManual ? (Number(eximLevy) || 0)  : Math.round(cifNum * 0.0075 * 100) / 100
  const silAmt       = importLeviesManual ? (Number(silLevy) || 0)   : Math.round(cifNum * 0.02 * 100) / 100
  const examAmt      = importLeviesManual ? (Number(examinationFee) || 0) : 0
  const clearingAmt  = Number(clearingAgentFee) || 0
  const vatBase      = cifNum + dutyAmt + ecowasAmt + auAmt + eximAmt + silAmt + examAmt
  const importTaxResult = applyTaxes
    ? calculateGhanaTaxes(vatBase)
    : { nhil: 0, getfund: 0, covid: 0, vat: 0, totalTax: 0, grandTotal: vatBase }
  const importGrandTotal = vatBase + (importTaxResult.totalTax ?? 0) + clearingAmt

  // Active tax result (standard or import)
  const activeTaxResult = isImportBill
    ? { ...importTaxResult, grandTotal: importGrandTotal }
    : taxResult

  // WHT: calculated on the grand total (gross, VAT-inclusive)
  const selectedWHTRate = GH_WHT_RATES.find(r => r.code === whtRateCode) ?? GH_WHT_RATES[0]
  const whtCalc = applyWHT
    ? calculateWHT(activeTaxResult.grandTotal, selectedWHTRate.rate)
    : { whtAmount: 0, netPayable: activeTaxResult.grandTotal }

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

    if (isImportBill) {
      if (!cifValue || Number(cifValue) <= 0) {
        setError("CIF value is required for import bills")
        return
      }
    } else {
      if (items.length === 0) {
        setError("Please add at least one item")
        return
      }
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
    }

    if (fxEnabled && fxCurrencyCode && (!fxRate || parseFloat(fxRate) <= 0)) {
      setError(`Exchange rate is required for ${fxCurrencyCode} bills. Please enter the current rate.`)
      return
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
          apply_wht: applyWHT,
          wht_rate_code: applyWHT ? whtRateCode : null,
          wht_rate: applyWHT ? selectedWHTRate.rate : null,
          wht_amount: applyWHT ? whtCalc.whtAmount : 0,
          status,
          attachment_path: attachmentPath || null,
          ...(fxEnabled && fxCurrencyCode && fxRate ? {
            currency_code: fxCurrencyCode,
            fx_rate: parseFloat(fxRate),
          } : {}),
          bill_type: isImportBill ? "import" : "standard",
          ...(isImportBill ? {
            import_description: importDescription.trim() || null,
            cif_value: cifNum,
            import_duty_rate: importDutyRate,
            import_duty_amount: dutyAmt,
            ecowas_levy: ecowasAmt,
            au_levy: auAmt,
            exim_levy: eximAmt,
            sil_levy: silAmt,
            examination_fee: examAmt,
            clearing_agent_fee: clearingAmt,
            landed_cost_account_code: landedCostAccount,
            items: [],
          } : {
            items: items.map((item) => ({
              description: item.description,
              qty: item.qty,
              unit_price: item.unit_price,
              discount_amount: item.discount_amount,
            })),
          }),
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

              {/* FX Currency Section */}
              <div className="mt-4">
                <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                  <div className="flex-1">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Bill in foreign currency?</span>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Supplier invoiced you in USD, EUR, GBP, etc. — booked in {currencyCode || "home currency"}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={fxEnabled}
                    onClick={() => setFxEnabled(!fxEnabled)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${fxEnabled ? "bg-purple-600" : "bg-gray-200 dark:bg-gray-600"}`}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${fxEnabled ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </div>
                {fxEnabled && (
                  <div className="mt-3 grid grid-cols-2 gap-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-700">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">Bill Currency</label>
                      <select
                        value={fxCurrencyCode}
                        onChange={(e) => setFxCurrencyCode(e.target.value)}
                        className="w-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white text-sm rounded-md p-2 focus:ring-purple-500 focus:border-purple-500"
                      >
                        <option value="USD">USD — US Dollar</option>
                        <option value="EUR">EUR — Euro</option>
                        <option value="GBP">GBP — British Pound</option>
                        <option value="KES">KES — Kenyan Shilling</option>
                        <option value="NGN">NGN — Nigerian Naira</option>
                        <option value="ZAR">ZAR — South African Rand</option>
                        <option value="CNY">CNY — Chinese Yuan</option>
                        <option value="INR">INR — Indian Rupee</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                        Rate: 1 {fxCurrencyCode} = ? {currencyCode || "home"}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={fxRate}
                        onChange={(e) => setFxRate(e.target.value)}
                        placeholder="e.g. 14.50"
                        className="w-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white text-sm rounded-md p-2 focus:ring-purple-500 focus:border-purple-500"
                      />
                    </div>
                    {fxRate && !isNaN(parseFloat(fxRate)) && parseFloat(fxRate) > 0 && (
                      <p className="col-span-2 text-xs text-purple-700 dark:text-purple-300">
                        Amounts entered in {fxCurrencyCode}. Booked in {currencyCode} at rate {parseFloat(fxRate).toFixed(4)}.
                      </p>
                    )}
                  </div>
                )}
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

            {/* Items / Import Breakdown */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">

              {/* Bill Type Toggle Header */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                    {isImportBill ? "Import / Customs Entry" : "Bill Items"}
                    {!isImportBill && ocrSuggestedFields.subtotal && (
                      <span className="ml-2 text-xs font-normal italic text-purple-600 dark:text-purple-400">From receipt</span>
                    )}
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {isImportBill
                      ? "Record CIF value, import duty, and port levies from customs entry"
                      : "Add line items as they appear on the supplier invoice"}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-sm font-medium ${!isImportBill ? "text-purple-700 dark:text-purple-300" : "text-gray-400 dark:text-gray-500"}`}>
                    Standard
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isImportBill}
                    onClick={() => setIsImportBill(!isImportBill)}
                    title="Toggle import / customs bill"
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${isImportBill ? "bg-indigo-600" : "bg-gray-200 dark:bg-gray-600"}`}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isImportBill ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                  <span className={`text-sm font-medium ${isImportBill ? "text-indigo-700 dark:text-indigo-300" : "text-gray-400 dark:text-gray-500"}`}>
                    Import / Customs
                  </span>
                </div>
              </div>

              {isImportBill ? (
                /* ── IMPORT BREAKDOWN ─────────────────────────────────── */
                <div className="space-y-6">

                  {/* Import description */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Goods Description
                    </label>
                    <input
                      type="text"
                      value={importDescription}
                      onChange={(e) => setImportDescription(e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:text-white"
                      placeholder="e.g. Samsung monitors × 20 — Electronics"
                    />
                  </div>

                  {/* CIF value + Duty rate */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        CIF Value *{" "}
                        <span className="font-normal text-gray-500">(Cost + Insurance + Freight)</span>
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{currency}</span>
                        <input
                          type="number"
                          value={cifValue}
                          onChange={(e) => setCifValue(e.target.value)}
                          min="0"
                          step="0.01"
                          required={isImportBill}
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:text-white"
                          placeholder="0.00"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Customs valuation base (from GRA / ICUMS assessment notice)</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Import Duty Rate <span className="font-normal text-gray-500">(ECOWAS CET)</span>
                      </label>
                      <select
                        value={importDutyRate}
                        onChange={(e) => setImportDutyRate(Number(e.target.value))}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:text-white"
                      >
                        <option value={0}>0% — Essential goods (medicine, seeds, agro inputs)</option>
                        <option value={0.05}>5% — Raw materials & capital goods</option>
                        <option value={0.10}>10% — Intermediate goods</option>
                        <option value={0.20}>20% — Consumer goods (most common)</option>
                        <option value={0.35}>35% — Sensitive goods (vehicles, beverages, etc.)</option>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        Duty amount: {currency}{dutyAmt.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {/* Port Levies */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Port Levies</h3>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className={!importLeviesManual ? "font-medium text-green-600 dark:text-green-400" : ""}>Auto</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={importLeviesManual}
                          onClick={() => setImportLeviesManual(!importLeviesManual)}
                          className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${importLeviesManual ? "bg-indigo-500" : "bg-green-500"}`}
                        >
                          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${importLeviesManual ? "translate-x-4" : "translate-x-0"}`} />
                        </button>
                        <span className={importLeviesManual ? "font-medium text-indigo-600 dark:text-indigo-400" : ""}>Manual</span>
                      </div>
                    </div>

                    <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-4 space-y-4 border border-indigo-100 dark:border-indigo-800">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {/* ECOWAS */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">ECOWAS Levy (0.5%)</label>
                          {importLeviesManual ? (
                            <input
                              type="number"
                              value={ecowasLevy}
                              onChange={(e) => setEcowasLevy(e.target.value)}
                              min="0" step="0.01"
                              className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm dark:bg-gray-700 dark:text-white"
                              placeholder="0.00"
                            />
                          ) : (
                            <div className="px-2 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded">
                              {currency}{ecowasAmt.toFixed(2)}
                            </div>
                          )}
                        </div>
                        {/* AU */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">AU Levy (0.2%)</label>
                          {importLeviesManual ? (
                            <input
                              type="number"
                              value={auLevy}
                              onChange={(e) => setAuLevy(e.target.value)}
                              min="0" step="0.01"
                              className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm dark:bg-gray-700 dark:text-white"
                              placeholder="0.00"
                            />
                          ) : (
                            <div className="px-2 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded">
                              {currency}{auAmt.toFixed(2)}
                            </div>
                          )}
                        </div>
                        {/* EXIM */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">EXIM Levy (0.75%)</label>
                          {importLeviesManual ? (
                            <input
                              type="number"
                              value={eximLevy}
                              onChange={(e) => setEximLevy(e.target.value)}
                              min="0" step="0.01"
                              className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm dark:bg-gray-700 dark:text-white"
                              placeholder="0.00"
                            />
                          ) : (
                            <div className="px-2 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded">
                              {currency}{eximAmt.toFixed(2)}
                            </div>
                          )}
                        </div>
                        {/* SIL — most imports, exemptions apply */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">SIL (2% — most imports)</label>
                          {importLeviesManual ? (
                            <input
                              type="number"
                              value={silLevy}
                              onChange={(e) => setSilLevy(e.target.value)}
                              min="0" step="0.01"
                              className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm dark:bg-gray-700 dark:text-white"
                              placeholder="0.00"
                            />
                          ) : (
                            <div className="px-2 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded">
                              {currency}{silAmt.toFixed(2)}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-indigo-100 dark:border-indigo-700">
                        {/* Examination fee */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Examination Fee (1% — used goods)</label>
                          <input
                            type="number"
                            value={examinationFee}
                            onChange={(e) => { setImportLeviesManual(true); setExaminationFee(e.target.value) }}
                            min="0" step="0.01"
                            className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm dark:bg-gray-700 dark:text-white"
                            placeholder="0.00"
                          />
                        </div>
                        {/* Clearing agent */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Clearing Agent Fee</label>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{currency}</span>
                            <input
                              type="number"
                              value={clearingAgentFee}
                              onChange={(e) => setClearingAgentFee(e.target.value)}
                              min="0" step="0.01"
                              className="w-full border border-gray-300 dark:border-gray-600 rounded pl-7 pr-2 py-1.5 text-sm dark:bg-gray-700 dark:text-white"
                              placeholder="0.00"
                            />
                          </div>
                          <p className="text-xs text-gray-500 mt-1">Posted to account 5220 (Clearing &amp; Forwarding)</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Landed cost account */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Post Landed Cost to Account
                    </label>
                    <select
                      value={landedCostAccount}
                      onChange={(e) => setLandedCostAccount(e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:text-white"
                    >
                      <option value="1200">1200 — Inventory (goods going into stock)</option>
                      <option value="1210">1210 — Import Goods &amp; Inventory (in-transit)</option>
                      <option value="5000">5000 — Cost of Goods Sold (COGS)</option>
                      <option value="5200">5200 — General Expenses (direct expense)</option>
                      <option value="5210">5210 — Import Duty &amp; Port Levies (expense)</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Where to debit CIF + duty + port levies ({currency}{vatBase.toFixed(2)})
                    </p>
                  </div>

                  {/* Import cost breakdown summary */}
                  <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-4 border border-indigo-200 dark:border-indigo-700">
                    <h4 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200 mb-3">📦 Landed Cost Summary</h4>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between text-indigo-700 dark:text-indigo-300">
                        <span>CIF Value:</span>
                        <span className="font-medium">{currency}{cifNum.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-indigo-700 dark:text-indigo-300">
                        <span>Import Duty ({(importDutyRate * 100).toFixed(0)}%):</span>
                        <span className="font-medium">{currency}{dutyAmt.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-indigo-500 dark:text-indigo-400 text-xs pl-2">
                        <span>ECOWAS Levy (0.5%):</span>
                        <span>{currency}{ecowasAmt.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-indigo-500 dark:text-indigo-400 text-xs pl-2">
                        <span>AU Levy (0.2%):</span>
                        <span>{currency}{auAmt.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-indigo-500 dark:text-indigo-400 text-xs pl-2">
                        <span>EXIM Levy (0.75%):</span>
                        <span>{currency}{eximAmt.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-indigo-500 dark:text-indigo-400 text-xs pl-2">
                        <span>SIL (2%):</span>
                        <span>{currency}{silAmt.toFixed(2)}</span>
                      </div>
                      {examAmt > 0 && (
                        <div className="flex justify-between text-indigo-500 dark:text-indigo-400 text-xs pl-2">
                          <span>Examination Fee (1%):</span>
                          <span>{currency}{examAmt.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-bold text-indigo-900 dark:text-indigo-100 pt-2 border-t border-indigo-200 dark:border-indigo-600">
                        <span>VAT Base (CIF + Duty + Levies):</span>
                        <span>{currency}{vatBase.toFixed(2)}</span>
                      </div>
                      {clearingAmt > 0 && (
                        <div className="flex justify-between text-gray-600 dark:text-gray-400 text-xs pt-1">
                          <span>Clearing Agent Fee (separate — 5220):</span>
                          <span>{currency}{clearingAmt.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                /* ── STANDARD ITEMS ───────────────────────────────────── */
                <div>
                  <div className="flex justify-end mb-4">
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
                            required={!isImportBill}
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
                            required={!isImportBill}
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
                            required={!isImportBill}
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
                </div>
              )}

              {/* Tax Toggle */}
              <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      Apply Ghana Taxes
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {isImportBill
                        ? "Apply NHIL (2.5%), GETFund (2.5%) and VAT (15%) on the VAT base"
                        : "Include NHIL, GETFund, and VAT (extracted from the tax-inclusive total)"}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={applyTaxes}
                    onClick={() => setApplyTaxes(!applyTaxes)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${applyTaxes ? "bg-blue-600" : "bg-gray-200 dark:bg-gray-600"}`}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${applyTaxes ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </div>
              </div>

              {/* WHT Toggle */}
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      Apply Withholding Tax (WHT)
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Deduct WHT at source and remit to GRA on supplier&apos;s behalf
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={applyWHT}
                    onClick={() => setApplyWHT(!applyWHT)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 ${applyWHT ? "bg-orange-500" : "bg-gray-200 dark:bg-gray-600"}`}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${applyWHT ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </div>
                {applyWHT && (
                  <div className="mt-3">
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">WHT Rate</label>
                    <select
                      value={whtRateCode}
                      onChange={(e) => setWhtRateCode(e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 dark:bg-gray-700 dark:text-white"
                    >
                      {GH_WHT_RATES.map(r => (
                        <option key={r.code} value={r.code}>{r.name}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{selectedWHTRate.description}</p>
                  </div>
                )}
              </div>

              {/* Totals Preview */}
              <div className="mt-6 pt-6 border-t-2 border-gray-300 dark:border-gray-600">
                <div className="flex justify-end">
                  <div className="w-80 space-y-3 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-lg p-5 border border-purple-200 dark:border-purple-700">
                    {isImportBill ? (
                      /* Import totals */
                      <>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-purple-800 dark:text-purple-300">VAT Base (landed cost):</span>
                          <span className="font-medium text-purple-900 dark:text-purple-200">{currency}{vatBase.toFixed(2)}</span>
                        </div>
                        {applyTaxes && (
                          <div className="space-y-1 pt-2 border-t border-purple-200 dark:border-purple-500">
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-purple-800 dark:text-purple-400">NHIL (2.5%):</span>
                              <span className="text-purple-900 dark:text-purple-300">{currency}{Number(importTaxResult.nhil ?? 0).toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-purple-800 dark:text-purple-400">GETFund (2.5%):</span>
                              <span className="text-purple-900 dark:text-purple-300">{currency}{Number(importTaxResult.getfund ?? 0).toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-purple-800 dark:text-purple-400">VAT (15%):</span>
                              <span className="text-purple-900 dark:text-purple-300">{currency}{Number(importTaxResult.vat ?? 0).toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between items-center pt-1 border-t border-purple-200 dark:border-purple-500">
                              <span className="text-purple-900 dark:text-purple-300 font-medium">Total Tax:</span>
                              <span className="font-semibold text-purple-900 dark:text-purple-300">{currency}{Number(importTaxResult.totalTax ?? 0).toFixed(2)}</span>
                            </div>
                          </div>
                        )}
                        {clearingAmt > 0 && (
                          <div className="flex justify-between items-center text-sm pt-1 border-t border-purple-200 dark:border-purple-500">
                            <span className="text-purple-800 dark:text-purple-400">Clearing Agent Fee:</span>
                            <span className="text-purple-900 dark:text-purple-300">{currency}{clearingAmt.toFixed(2)}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      /* Standard totals */
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-purple-900 dark:text-purple-300 font-medium">
                            {applyTaxes ? "Subtotal (before tax):" : "Subtotal:"}
                          </span>
                          <span className="font-semibold text-purple-900 dark:text-purple-300 text-lg">{currency}{Number(taxResult.subtotalBeforeTax ?? 0).toFixed(2)}</span>
                        </div>
                        {applyTaxes && (() => {
                          const countryCode = businessCountry ? normalizeCountry(businessCountry) : null
                          const isGhana = countryCode === "GH"
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
                      </>
                    )}

                    {/* Grand Total row — always shown */}
                    <div className="flex justify-between items-center pt-3 border-t-2 border-purple-300 dark:border-purple-500">
                      <span className="text-purple-900 dark:text-purple-300 font-bold text-lg">
                        {applyWHT ? "Gross Total:" : "Total:"}
                      </span>
                      <span className="font-bold text-purple-600 dark:text-purple-400 text-xl">
                        {currency}{Number(activeTaxResult.grandTotal ?? 0).toFixed(2)}
                      </span>
                    </div>

                    {applyWHT && (
                      <>
                        <div className="flex justify-between items-center text-sm pt-2 border-t border-orange-200 dark:border-orange-700">
                          <span className="text-orange-700 dark:text-orange-400 font-medium">
                            WHT Deduction ({(selectedWHTRate.rate * 100).toFixed(0)}%):
                          </span>
                          <span className="text-orange-700 dark:text-orange-400 font-semibold">
                            − {currency}{whtCalc.whtAmount.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t-2 border-orange-300 dark:border-orange-600">
                          <span className="text-orange-900 dark:text-orange-200 font-bold text-lg">Net to Supplier:</span>
                          <span className="font-bold text-orange-600 dark:text-orange-400 text-xl">
                            {currency}{whtCalc.netPayable.toFixed(2)}
                          </span>
                        </div>
                        <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                          {currency}{whtCalc.whtAmount.toFixed(2)} WHT will be remitted to GRA
                        </p>
                      </>
                    )}
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

