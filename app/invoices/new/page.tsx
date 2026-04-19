"use client"

import { useState, useEffect, memo, useCallback, useMemo } from "react"
import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { calculateTaxes, getLegacyTaxAmounts } from "@/lib/taxEngine"
import SendInvoiceChoiceModal, { SendMethod } from "@/components/invoices/SendInvoiceChoiceModal"
import InvoicePreviewModal from "@/components/invoices/InvoicePreviewModal"
import Toast from "@/components/Toast"
import { getCurrencySymbol } from "@/lib/currency"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { GH_WHT_RATES, calculateWHT } from "@/lib/wht"

// FINZA Design System Components (Phase 2 Refactor)
import { StatusBadge } from "@/components/ui/StatusBadge"
import { NativeSelect } from "@/components/ui/NativeSelect"
import { MenuSelect, type MenuSelectOption } from "@/components/ui/MenuSelect"
import { formatMoney, formatMoneyWithSymbol } from "@/lib/money"
import { openWhatsAppUrlInBrowser } from "@/lib/communication/openWhatsAppClient"

type Customer = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  address?: string | null
}

type InvoiceItem = {
  id: string
  product_id: string | null
  description: string
  quantity: number
  price: number
  discount_type: "amount" | "percent"
  discount_value: number
  total: number
  // Raw strings kept during editing so decimal points / partial input aren't
  // lost on every keystroke (number inputs discard "500." immediately)
  _rawQty?: string
  _rawPrice?: string
  _rawDiscount?: string
}

const round2 = (value: number): number => Math.round((value || 0) * 100) / 100

const getDiscountAmount = (item: Pick<InvoiceItem, "quantity" | "price" | "discount_type" | "discount_value">): number => {
  const gross = Math.max(0, (Number(item.quantity) || 0) * (Number(item.price) || 0))
  const rawDiscount = Number(item.discount_value) || 0
  if (rawDiscount <= 0 || gross <= 0) return 0

  const discount = item.discount_type === "percent"
    ? (gross * rawDiscount) / 100
    : rawDiscount

  return round2(Math.min(Math.max(discount, 0), gross))
}

const getLineTotal = (item: Pick<InvoiceItem, "quantity" | "price" | "discount_type" | "discount_value">): number => {
  const gross = (Number(item.quantity) || 0) * (Number(item.price) || 0)
  return round2(Math.max(0, gross - getDiscountAmount(item)))
}

// Stable wrapper for service route: avoids defining a component inline inside
// NewInvoicePage so that re-renders (e.g. typing in New Customer modal) don't
// remount the whole tree and cause input focus loss / "snappy" behaviour.
const FragmentWrapper = ({ children }: { children: React.ReactNode }) => <>{children}</>

// ------------------------------------------------------------
// LINE ITEM ROW — memoised so typing in description doesn't
// cause the parent (and all siblings) to re-render on every
// keystroke, eliminating the "snappy jump" scroll issue.
// ------------------------------------------------------------
type LineItemRowProps = {
  item: InvoiceItem
  productMenuOptions: MenuSelectOption[]
  /** ISO code for line totals (matches invoice view formatMoney). */
  amountCurrencyCode: string | null
  onUpdate: (id: string, field: keyof InvoiceItem | "_rawQty" | "_rawPrice" | "_rawDiscount", value: any) => void
  onCommit: (id: string, field: "quantity" | "price" | "discount_value") => void
  onRemove: (id: string) => void
  onSelectProduct: (itemId: string, productId: string) => void
}

const LineItemRow = memo(function LineItemRow({
  item, productMenuOptions, amountCurrencyCode,
  onUpdate, onCommit, onRemove, onSelectProduct,
}: LineItemRowProps) {
  // Local description state — typed into immediately, flushed to parent only on blur
  const [localDesc, setLocalDesc] = useState(item.description)

  // Sync if description is changed externally (e.g. product selected from dropdown)
  useEffect(() => {
    setLocalDesc(item.description)
  }, [item.description])

  return (
    <tr className="group hover:bg-slate-50/50 transition-colors">
      <td className="min-w-0 px-4 py-3 align-top sm:px-6">
        <div className="space-y-1.5">
          <MenuSelect
            value={item.product_id || ""}
            onValueChange={(v) => (v ? onSelectProduct(item.id, v) : onUpdate(item.id, "product_id", null))}
            options={productMenuOptions}
            placeholder="Select product or service…"
            size="sm"
          />
          <textarea
            value={localDesc}
            onChange={(e) => setLocalDesc(e.target.value)}
            onBlur={() => onUpdate(item.id, "description", localDesc)}
            placeholder="Description"
            rows={1}
            className="block w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 py-1.5 resize-none"
          />
        </div>
      </td>
      <td className="px-3 py-3 align-top sm:px-4">
        <input
          type="text"
          inputMode="numeric"
          value={item._rawQty ?? (item.quantity === 0 ? "" : String(item.quantity))}
          onChange={(e) => onUpdate(item.id, "quantity", e.target.value)}
          onBlur={() => onCommit(item.id, "quantity")}
          onFocus={(e) => e.target.select()}
          placeholder="1"
          className="block w-full min-w-[3.5rem] min-h-[2.25rem] text-center text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 px-2 py-2 tabular-nums"
        />
      </td>
      <td className="px-3 py-3 align-top sm:px-4">
        <input
          type="text"
          inputMode="decimal"
          value={item._rawPrice ?? (item.price === 0 ? "" : String(item.price))}
          onChange={(e) => onUpdate(item.id, "price", e.target.value)}
          onBlur={() => onCommit(item.id, "price")}
          onFocus={(e) => e.target.select()}
          placeholder="0.00"
          className="block w-full min-w-[5.5rem] min-h-[2.25rem] text-right text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 px-2 py-2 tabular-nums"
        />
      </td>
      <td className="px-3 py-3 align-top sm:px-4">
        <div className="flex min-w-0 items-stretch gap-2">
          <NativeSelect
            value={item.discount_type}
            onChange={(e) => onUpdate(item.id, "discount_type", e.target.value as "amount" | "percent")}
            aria-label="Discount type"
            size="sm"
            wrapperClassName="w-[4.5rem] shrink-0 self-center"
          >
            <option value="amount">Amt</option>
            <option value="percent">%</option>
          </NativeSelect>
          <input
            type="text"
            inputMode="decimal"
            value={item._rawDiscount ?? (item.discount_value === 0 ? "" : String(item.discount_value))}
            onChange={(e) => onUpdate(item.id, "discount_value", e.target.value)}
            onBlur={() => onCommit(item.id, "discount_value")}
            onFocus={(e) => e.target.select()}
            placeholder={item.discount_type === "percent" ? "0" : "0.00"}
            className="min-w-0 flex-1 min-h-[2.25rem] text-right text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 px-2 py-2 tabular-nums"
          />
        </div>
      </td>
      <td className="px-4 py-3 align-top text-right text-sm font-medium text-slate-900 tabular-nums whitespace-nowrap sm:px-6 sm:text-base sm:pt-5">
        {formatMoney(item.total, amountCurrencyCode)}
      </td>
      <td className="px-2 py-3 align-top pt-4">
        <button
          onClick={() => onRemove(item.id)}
          className="text-slate-400 hover:text-red-600 transition-colors p-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </td>
    </tr>
  )
})

// ------------------------------------------------------------
// PRIMARY COMPONENT: NewInvoicePage
// Refactored to "Paper Metaphor" Draft Document
// ------------------------------------------------------------
export default function NewInvoicePage() {
  const router = useRouter()
  const pathname = usePathname()
  const isUnderService = pathname?.startsWith("/service") ?? false

  // -- State Management --
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("")
  const [issueDate, setIssueDate] = useState<string>(new Date().toISOString().split("T")[0])
  const [dueDate, setDueDate] = useState<string>("")
  const [notes, setNotes] = useState<string>("")
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [businessIndustry, setBusinessIndustry] = useState<string | null>(null)
  const [businessCountry, setBusinessCountry] = useState<string | null>(null)

  // Invoice from Job (service workspace only)
  const [invoiceFromJob, setInvoiceFromJob] = useState(false)
  const [jobs, setJobs] = useState<{ id: string; status: string; start_date: string | null; end_date: string | null; customers?: { name: string } | null }[]>([])
  const [selectedJobId, setSelectedJobId] = useState("")
  const [jobMaterialCost, setJobMaterialCost] = useState<number | null>(null)

  // New Customer Form State
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState("")
  const [newCustomerEmail, setNewCustomerEmail] = useState("")
  const [newCustomerPhone, setNewCustomerPhone] = useState("")
  const [newCustomerAddress, setNewCustomerAddress] = useState("")
  const [newCustomerTin, setNewCustomerTin] = useState("")
  const [newCustomerWhatsapp, setNewCustomerWhatsapp] = useState("")
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [customerError, setCustomerError] = useState("")

  // Accounting Settings
  const [applyGhanaTax, setApplyGhanaTax] = useState(true)
  const [currencySymbol, setCurrencySymbol] = useState<string>("")
  const [currencyCode, setCurrencyCode] = useState<string | null>(null)

  // FX (foreign currency) settings
  const [fxEnabled, setFxEnabled] = useState(false)
  const [fxCurrencyCode, setFxCurrencyCode] = useState<string>("USD")
  const [fxRate, setFxRate] = useState<string>("")

  // WHT suffered — when a corporate customer withholds tax from payment
  const [applyWHTReceivable, setApplyWHTReceivable] = useState(false)
  const [whtReceivableRateCode, setWhtReceivableRateCode] = useState("GH_SVC_5")

  // Symbol used for all amount displays — switches to FX symbol when FX is enabled
  const displaySymbol = fxEnabled && fxCurrencyCode
    ? (getCurrencySymbol(fxCurrencyCode) || fxCurrencyCode)
    : currencySymbol

  // ISO code for formatMoney (invoice view / lists style — sans tabular-nums)
  const amountCurrencyCode = fxEnabled && fxCurrencyCode ? fxCurrencyCode : currencyCode

  // Modals & Navigation
  const [showSendChoiceModal, setShowSendChoiceModal] = useState(false)
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [createdInvoiceId, setCreatedInvoiceId] = useState<string | null>(null)
  const [createdInvoiceCustomer, setCreatedInvoiceCustomer] = useState<any>(null)
  const [previewInvoiceId, setPreviewInvoiceId] = useState<string | null>(null)
  const [toast, setToast] = useState<{
    message: string
    type: "success" | "error" | "info"
    duration?: number
  } | null>(null)

  const invoiceViewHref = (id: string) =>
    pathname?.startsWith("/service") ? `/service/invoices/${id}/view` : `/invoices/${id}/view`

  useEffect(() => {
    loadData()
  }, [])

  // When job selected, fetch total material cost for display (service workspace only)
  useEffect(() => {
    if (businessIndustry !== "service" || !selectedJobId || !businessId) {
      setJobMaterialCost(null)
      return
    }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from("service_job_material_usage")
        .select("total_cost")
        .eq("job_id", selectedJobId)
        .eq("business_id", businessId)
      if (cancelled || !data) return
      const total = (data as { total_cost: number }[]).reduce((s, r) => s + Number(r.total_cost || 0), 0)
      if (!cancelled) setJobMaterialCost(total)
    })()
    return () => { cancelled = true }
  }, [businessIndustry, selectedJobId, businessId])

  // -- Data Loading --
  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) return

      setBusinessId(business.id)
      const industry = (business as { industry?: string }).industry ?? null
      setBusinessIndustry(industry)

      const { data: businessDetails } = await supabase
        .from("businesses")
        .select("address_country, default_currency")
        .eq("id", business.id)
        .single()
      setBusinessCountry(businessDetails?.address_country || null)

      const businessCurrency = businessDetails?.default_currency || null
      setCurrencyCode(businessCurrency)

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

      // Load Customers
      const { data: customersData } = await supabase
        .from("customers")
        .select("id, name, email, phone, address, tin, whatsapp_phone")
        .eq("business_id", business.id)
        .is("deleted_at", null)
        .order("name", { ascending: true })

      setCustomers(customersData || [])

      // Load items: service_catalog for service industry, else products_services (no retail products)
      if (industry === "service") {
        const { data: catalogData } = await supabase
          .from("service_catalog")
          .select("*")
          .eq("business_id", business.id)
          .eq("is_active", true)
          .order("name", { ascending: true })
        if (catalogData && catalogData.length > 0) {
          setProducts(catalogData.map((p: any) => ({
            id: p.id,
            name: p.name,
            price: Number(p.default_price) || 0,
            tax_code: p.tax_code ?? null,
          })))
        } else {
          setProducts([])
        }
        // Load jobs for "Invoice from Job" dropdown (draft + in_progress)
        const { data: jobsData } = await supabase
          .from("service_jobs")
          .select("id, status, start_date, end_date, customers(name)")
          .eq("business_id", business.id)
          .in("status", ["draft", "in_progress"])
          .order("created_at", { ascending: false })
        setJobs((jobsData || []) as any[])
      } else {
      // Load products_services (non-service workspace)
      const { data: productsData } = await supabase
        .from("products_services")
        .select("id, name, unit_price")
        .eq("business_id", business.id)
        .is("deleted_at", null)
        .order("name", { ascending: true })

      if (productsData && productsData.length > 0) {
        setProducts(productsData.map((p: any) => ({
          id: p.id,
          name: p.name,
          price: Number(p.unit_price) || 0,
        })))
      } else {
        // Fallback to old 'products' table if 'products_services' is empty (non-service only)
        const { data: fallbackProducts } = await supabase
          .from("products")
          .select("id, name, price")
          .eq("business_id", business.id)
          .order("name", { ascending: true })

        if (fallbackProducts) {
          setProducts(fallbackProducts.map((p: any) => ({
            id: p.id,
            name: p.name,
            price: Number(p.price) || 0,
          })))
        }
      }
      }

    } catch (err: any) {
      console.error("Error loading data:", err)
      setError("Failed to load initial data. Please refresh.")
    }
  }

  // -- Item Management --
  // All mutations use functional setItems so useCallback deps stay stable ([]),
  // which keeps callback references stable across renders and lets LineItemRow
  // memo comparisons actually short-circuit (no re-renders while typing).
  const addItem = useCallback(() => {
    setItems(prev => [
      ...prev,
      {
        id: Date.now().toString(),
        product_id: null,
        description: "",
        quantity: 1,
        price: 0,
        discount_type: "amount",
        discount_value: 0,
        total: 0,
      },
    ])
  }, [])

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter((item) => item.id !== id))
  }, [])

  const updateItem = useCallback((id: string, field: keyof InvoiceItem | "_rawQty" | "_rawPrice" | "_rawDiscount", value: any) => {
    setItems(prev => prev.map((item) => {
      if (item.id !== id) return item
      const updated = { ...item }

      if (field === "quantity" || field === "price" || field === "discount_value") {
        // Keep raw string so the input can show "500." without losing the dot
        if (field === "quantity") updated._rawQty = String(value)
        if (field === "price")    updated._rawPrice = String(value)
        if (field === "discount_value") updated._rawDiscount = String(value)
        const numValue = value === "" || value === null || value === undefined
          ? 0
          : parseFloat(String(value))
        updated[field] = isNaN(numValue) ? 0 : numValue
        updated.total = getLineTotal(updated)
      } else if (field === "_rawQty") {
        updated._rawQty = value
      } else if (field === "_rawPrice") {
        updated._rawPrice = value
      } else if (field === "_rawDiscount") {
        updated._rawDiscount = value
      } else {
        (updated as any)[field] = value
        if (field === "discount_type") {
          updated.total = getLineTotal(updated)
        }
      }
      return updated
    }))
  }, [])

  // Called on blur — clears raw strings so the formatted number displays cleanly
  const commitItem = useCallback((id: string, field: "quantity" | "price" | "discount_value") => {
    setItems(prev => prev.map((item) => {
      if (item.id !== id) return item
      const updated = { ...item }
      if (field === "quantity") updated._rawQty = undefined
      if (field === "price")    updated._rawPrice = undefined
      if (field === "discount_value") updated._rawDiscount = undefined
      return updated
    }))
  }, [])

  // products is loaded once on mount and never changes after that, so
  // [products] dep recreates this callback at most twice (empty → loaded).
  const selectProduct = useCallback((itemId: string, productId: string) => {
    const product = products.find((p) => p.id === productId)
    if (!product) return
    setItems(prev => prev.map(it => {
      if (it.id !== itemId) return it
      const qty = it.quantity || 1
      const price = Number(product.price) || 0
      const nextItem = { ...it, product_id: productId, description: product.name, price, quantity: qty }
      return { ...nextItem, total: getLineTotal(nextItem) }
    }))
  }, [products])

  // -- Financial Calculations (Strictly Preserved) --
  // Calculate subtotal from line items (sum of all line totals)
  let subtotal = items.reduce((sum, item) => sum + getLineTotal(item), 0)
  const totalDiscount = items.reduce((sum, item) => sum + getDiscountAmount(item), 0)

  // Tax Engine Integration
  const effectiveDate = issueDate || new Date().toISOString().split('T')[0]

  const lineItems = items.map((item) => ({
    quantity: Number(item.quantity) || 0,
    unit_price: Number(item.price) || 0,
    discount_amount: getDiscountAmount(item),
  }))

  let tax = 0
  let total = subtotal
  let baseSubtotal = subtotal
  let legacyTaxAmounts: ReturnType<typeof getLegacyTaxAmounts> | null = null

  if (applyGhanaTax && items.length > 0 && subtotal > 0) {
    const taxCalculationResult = calculateTaxes(
      lineItems,
      businessCountry,
      effectiveDate,
      true // tax-inclusive pricing
    )

    baseSubtotal = taxCalculationResult.subtotal_excl_tax
    total = taxCalculationResult.total_incl_tax
    tax = taxCalculationResult.tax_total
    legacyTaxAmounts = getLegacyTaxAmounts(taxCalculationResult)
  }

  // WHT receivable — applied on pre-tax base, NOT the VAT-inclusive total.
  // GRA: you do not withhold tax on tax (NHIL/GETFund/VAT are excluded from the WHT base).
  // baseSubtotal = subtotal_excl_tax when Ghana tax is on; equals subtotal when tax is off.
  const selectedWHTRecvRate = GH_WHT_RATES.find(r => r.code === whtReceivableRateCode) ?? GH_WHT_RATES[0]
  const whtRecvCalc = applyWHTReceivable
    ? (() => {
        const { whtAmount } = calculateWHT(baseSubtotal, selectedWHTRecvRate?.rate ?? 0)
        return { whtAmount, netPayable: Math.round((total - whtAmount) * 100) / 100 }
      })()
    : { whtAmount: 0, netPayable: total }

  // -- Actions --
  const handleCreateCustomer = async (e?: React.SyntheticEvent) => {
    e?.preventDefault()
    setCustomerError("")
    if (!newCustomerName.trim()) {
      setCustomerError("Customer name is required")
      return
    }

    try {
      setCreatingCustomer(true)
      const { data: newCustomer, error: insertError } = await supabase.from("customers").insert({
        business_id: businessId,
        name: newCustomerName.trim(),
        email: newCustomerEmail.trim() || null,
        phone: newCustomerPhone.trim() || null,
        address: newCustomerAddress.trim() || null,
        tin: newCustomerTin.trim() || null,
        whatsapp_phone: newCustomerWhatsapp.trim() || null,
      }).select().single()

      if (insertError) throw insertError

      // Refresh customers and select new one
      const { data: allCustomers } = await supabase
        .from("customers")
        .select("id, name, email, phone, address, tin, whatsapp_phone")
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .order("name", { ascending: true })

      setCustomers(allCustomers || [])
      if (newCustomer) setSelectedCustomerId(newCustomer.id)

      setShowCustomerModal(false)
      setNewCustomerName("")
      setNewCustomerEmail("")
      setNewCustomerPhone("")
      setNewCustomerAddress("")
      setNewCustomerTin("")
      setNewCustomerWhatsapp("")
      setCreatingCustomer(false)
    } catch (err: any) {
      setCustomerError(err.message || "Failed to create customer")
      setCreatingCustomer(false)
    }
  }

  const validateForm = () => {
    if (!businessId) { setError("Business not found."); return false }
    if (!selectedCustomerId) { setError("Please select a customer"); return false }
    if (items.length === 0) { setError("Please add at least one item"); return false }
    return true
  }

  const handleSave = async (status: 'draft' | 'sent', sendMethod?: SendMethod) => {
    setError("")
    if (!validateForm()) return

    // Guardrail: Invalid amounts or missing data
    if (items.some(i => i.price < 0 || i.quantity <= 0)) {
      setError("Items contain invalid quantities or prices.")
      return
    }

    try {
      setLoading(true)

      const payload: Record<string, any> = {
        business_id: businessId,
        customer_id: selectedCustomerId,
        issue_date: issueDate,
        due_date: dueDate || null,
        notes: notes || null,
        apply_taxes: applyGhanaTax,
        status: "draft", // Always create as draft first
        wht_receivable_applicable: applyWHTReceivable,
        wht_receivable_rate: applyWHTReceivable ? (selectedWHTRecvRate?.rate ?? null) : null,
        wht_receivable_amount: applyWHTReceivable ? whtRecvCalc.whtAmount : 0,
        ...(fxEnabled && fxCurrencyCode && fxRate ? {
          currency_code: fxCurrencyCode,
          fx_rate: parseFloat(fxRate),
        } : {}),
        items: items.map(item => ({
          product_service_id: item.product_id || null,
          description: item.description || "",
          qty: Number(item.quantity) || 0,
          unit_price: Number(item.price) || 0,
          discount_amount: getDiscountAmount(item),
          line_subtotal: getLineTotal(item)
        }))
      }

      const response = await fetch("/api/invoices/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errData = await response.json()
        throw new Error(errData.error || errData.message || "Failed to save invoice")
      }

      const data = await response.json()
      const invoiceId = data.invoiceId || data.invoice?.id

      if (!invoiceId) throw new Error("Invoice ID missing from response")

      setCreatedInvoiceId(invoiceId)

      // Link invoice to job if "Invoice from Job" was used (service workspace only)
      if (selectedJobId && businessId) {
        await supabase
          .from("service_jobs")
          .update({ invoice_id: invoiceId })
          .eq("id", selectedJobId)
          .eq("business_id", businessId)
      }

      if (status === 'sent') {
        // If user wanted to send immediately, we now have the ID
        // Fetch customer data needed for send modal
        const selectedCustomer = customers.find(c => c.id === selectedCustomerId)
        setCreatedInvoiceCustomer(selectedCustomer)
        setShowSendChoiceModal(true)
        setLoading(false)
      } else {
        // Draft saved - redirect to view
        router.push(invoiceViewHref(invoiceId))
      }

    } catch (err: any) {
      console.error("Save Error:", err)
      setError(err.message || "Failed to save invoice")
      setLoading(false)
    }
  }

  // -- Render Helpers --
  const countryCode = businessCountry ? normalizeCountry(businessCountry) : null
  const isGhana = countryCode === "GH"

  const customerMenuOptions = useMemo(
    () => [
      { value: "", label: "Select a customer..." },
      ...customers.map((c) => ({ value: c.id, label: c.name })),
    ],
    [customers]
  )

  const productMenuOptions = useMemo((): MenuSelectOption[] => {
    const emptyLabel =
      businessIndustry === "service" ? "Select Service" : "Select product (optional)..."
    return [
      { value: "", label: emptyLabel },
      ...products.map((p) => ({
        value: p.id,
        label: `${p.name}${p.price != null ? ` — ${formatMoneyWithSymbol(Number(p.price), displaySymbol)}` : ""}`,
      })),
    ]
  }, [products, businessIndustry, displaySymbol])

  // When under /service/*, the service layout already provides ProtectedLayout (sidebar + header).
  // Avoid double layout (double header/logout and shifted content).
  const Wrapper = isUnderService ? FragmentWrapper : ProtectedLayout

  return (
    <Wrapper>
      <div className="min-h-screen bg-gray-50/50 dark:bg-gray-950 pb-20 font-sans">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* Header / Nav */}
          <div className="flex items-center justify-between mb-8">
            <button
              onClick={() => router.back()}
              className="group flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors"
            >
              <svg className="w-4 h-4 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Invoices
            </button>
            <div className="flex items-center gap-2">
              <StatusBadge status="draft" className="opacity-75" />
              <span className="text-xs text-slate-400 font-mono">NEW INVOICE</span>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="mb-6 rounded-md bg-red-50 border border-red-200 p-4 flex items-start gap-3">
              <svg className="w-5 h-5 text-red-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <div className="text-sm text-red-800">
                {error.includes("Business currency is required") || error.includes("Currency symbol not available") ? (
                  <>
                    Business currency is not set.{" "}
                    <Link
                      href="/settings/business-profile"
                      className="underline font-semibold hover:text-red-900"
                    >
                      Set it here →
                    </Link>
                  </>
                ) : (
                  error
                )}
              </div>
            </div>
          )}

          {/* Main Document Card (Paper Metaphor) */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">

            {/* 1. Header Section */}
            <div className="p-8 border-b border-slate-100 dark:border-slate-700">
              <div className="flex flex-col md:flex-row justify-between items-start gap-8">
                <div>
                  <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight mb-1">New Invoice</h1>
                  <p className="text-sm text-slate-500">Drafting a new financial document</p>
                </div>
                <div className="w-full md:w-auto flex flex-col items-end gap-1">
                  <div className="text-right">
                    <span className="block text-xs uppercase font-bold text-slate-400 tracking-wider mb-1">Invoice Number</span>
                    <div className="text-sm font-mono text-slate-400 bg-slate-50 px-3 py-1.5 rounded border border-slate-200 inline-block">
                      AUTO-ASSIGNED
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 max-w-[200px] text-right">
                    Assigned automatically upon finalization.
                  </p>
                </div>
              </div>
            </div>

            {/* 2. Customer & Dates Section */}
            <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
              {/* Customer Selection */}
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Bill To</label>
                  <button
                    onClick={() => setShowCustomerModal(true)}
                    className="text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    New Customer
                  </button>
                </div>
                <MenuSelect
                  value={selectedCustomerId}
                  onValueChange={setSelectedCustomerId}
                  options={customerMenuOptions}
                  placeholder="Select a customer..."
                  size="lg"
                  className="bg-slate-50 hover:bg-slate-100 dark:bg-slate-700"
                />
                {selectedCustomerId && (() => {
                  const c = customers.find(x => x.id === selectedCustomerId)
                  if (c?.address || c?.email || c?.phone) {
                    return (
                      <div className="text-xs text-slate-500 pl-1 space-y-1 border-l-2 border-slate-100 dark:border-slate-700">
                        {c.address && <p>{c.address}</p>}
                        {c.email && <p>{c.email}</p>}
                        {c.phone && <p>{c.phone}</p>}
                      </div>
                    )
                  }
                })()}
              </div>

              {/* Dates & Meta */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Issue Date</label>
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 p-2.5"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Due Date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 p-2.5"
                  />
                </div>

                {/* FX Currency Section */}
                <div className="col-span-2 pt-1">
                  <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-md border border-slate-100">
                    <div className="flex-1">
                      <span className="text-sm font-medium text-slate-700">Invoice in foreign currency?</span>
                      <p className="text-xs text-slate-500">Issue this invoice in USD, EUR, GBP, etc. — booked in {currencyCode || "home currency"}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={fxEnabled}
                      onClick={() => setFxEnabled(!fxEnabled)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${fxEnabled ? 'bg-blue-600' : 'bg-slate-300'}`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${fxEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  {fxEnabled && (
                    <div className="mt-3 grid grid-cols-2 gap-3 p-3 bg-blue-50 rounded-md border border-blue-100">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Invoice Currency</label>
                        <NativeSelect
                          value={fxCurrencyCode}
                          onChange={(e) => setFxCurrencyCode(e.target.value)}
                          className="bg-white dark:bg-slate-800"
                          size="sm"
                        >
                          <option value="USD">USD — US Dollar</option>
                          <option value="EUR">EUR — Euro</option>
                          <option value="GBP">GBP — British Pound</option>
                          <option value="KES">KES — Kenyan Shilling</option>
                          <option value="NGN">NGN — Nigerian Naira</option>
                          <option value="ZAR">ZAR — South African Rand</option>
                        </NativeSelect>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                          Rate: 1 {fxCurrencyCode} = ? {currencyCode || "home"}
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={fxRate}
                          onChange={(e) => setFxRate(e.target.value)}
                          placeholder="e.g. 14.50"
                          className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      {fxRate && !isNaN(parseFloat(fxRate)) && parseFloat(fxRate) > 0 && (
                        <p className="col-span-2 text-xs text-slate-500">
                          Prices entered in {fxCurrencyCode}. Booked in {currencyCode} at rate {parseFloat(fxRate).toFixed(4)}.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Invoice from Job (service workspace only) */}
            {businessIndustry === "service" && (
              <div className="p-8 border-t border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3 mb-4">
                  <input
                    type="checkbox"
                    id="invoiceFromJob"
                    checked={invoiceFromJob}
                    onChange={(e) => {
                      setInvoiceFromJob(e.target.checked)
                      if (!e.target.checked) setSelectedJobId("")
                    }}
                    className="rounded border-slate-300"
                  />
                  <label htmlFor="invoiceFromJob" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Invoice from Project?
                  </label>
                </div>
                {invoiceFromJob && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Project</label>
                      <NativeSelect
                        value={selectedJobId}
                        onChange={(e) => setSelectedJobId(e.target.value)}
                        wrapperClassName="max-w-md"
                        className="bg-slate-50 dark:bg-slate-700"
                        size="md"
                      >
                        <option value="">Select a project...</option>
                        {jobs.map((j) => (
                          <option key={j.id} value={j.id}>
                            {(j as any).customers?.name ?? "Project"} — {j.status} {j.start_date ? `(${j.start_date})` : ""}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    {selectedJobId && jobMaterialCost != null && (
                      <p className="text-sm text-slate-500">
                        Total material cost (read-only):{" "}
                        <span className="font-medium tabular-nums">{formatMoney(Number(jobMaterialCost), currencyCode)}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 3. High Density Line Items Table */}
            <div className="border-t border-slate-200 dark:border-slate-700">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 sm:px-6">
                <button
                  type="button"
                  onClick={addItem}
                  className="text-sm font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  Add Line Item
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[56rem] table-fixed text-sm text-left">
                  <colgroup>
                    <col style={{ width: "38%" }} />
                    <col style={{ width: "5.75rem" }} />
                    <col style={{ width: "9.5rem" }} />
                    <col style={{ width: "13.5rem" }} />
                    <col style={{ width: "9.5rem" }} />
                    <col style={{ width: "2.75rem" }} />
                  </colgroup>
                  <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 uppercase border-b border-slate-200">
                    <tr>
                      <th className="min-w-0 px-4 py-3 font-semibold sm:px-6">Item Description</th>
                      <th className="whitespace-nowrap px-3 py-3 text-center font-semibold sm:px-4">Qty</th>
                      <th className="whitespace-nowrap px-3 py-3 text-right font-semibold sm:px-4">Price</th>
                      <th className="whitespace-nowrap px-3 py-3 text-right font-semibold sm:px-4">Discount</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right font-semibold sm:px-6">Total</th>
                      <th className="w-10 py-3" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic bg-slate-50/30">
                          No line items added. Use &quot;Add Line Item&quot; above to start.
                        </td>
                      </tr>
                    ) : (
                      items.map((item) => (
                        <LineItemRow
                          key={item.id}
                          item={item}
                          productMenuOptions={productMenuOptions}
                          amountCurrencyCode={amountCurrencyCode}
                          onUpdate={updateItem}
                          onCommit={commitItem}
                          onRemove={removeItem}
                          onSelectProduct={selectProduct}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 4. Financial Summary Panel */}
            <div className="p-8 border-t border-slate-200 grid grid-cols-1 lg:grid-cols-2 gap-12">
              <div className="space-y-4">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Internal Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 p-3"
                  rows={4}
                  placeholder="Add notes about payment terms or internal details (visible on invoice)..."
                />
              </div>

              <div className="space-y-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-semibold text-slate-800">Add Ghana taxes</span>
                      <p className="text-xs text-slate-500 mt-0.5">Apply VAT/NHIL/GetFund during tax calculation</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={applyGhanaTax}
                      onClick={() => setApplyGhanaTax(!applyGhanaTax)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${applyGhanaTax ? 'bg-blue-600' : 'bg-slate-300'}`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${applyGhanaTax ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>
                </div>

                {/* Subtotal */}
                <div className="flex justify-between items-center text-sm text-slate-600">
                  <span>Subtotal</span>
                  <span className="font-medium tabular-nums">
                    {formatMoney(applyGhanaTax ? total : baseSubtotal, amountCurrencyCode)}
                  </span>
                </div>

                {/* Discounts */}
                {totalDiscount > 0 && (
                  <div className="flex justify-between items-center text-sm text-slate-600">
                    <span>Discounts</span>
                    <span className="font-medium tabular-nums text-rose-600">
                      −{formatMoney(totalDiscount, amountCurrencyCode)}
                    </span>
                  </div>
                )}

                {/* Tax breakdown (Visual Only) */}
                {applyGhanaTax && legacyTaxAmounts && (
                  <div className="py-3 border-y border-slate-100 space-y-2">
                    {isGhana && (
                      <>
                        {legacyTaxAmounts.nhil > 0 && (
                          <div className="flex justify-between items-center text-xs text-slate-500">
                            <span>NHIL (2.5%)</span>
                            <span className="tabular-nums">{formatMoney(legacyTaxAmounts.nhil, amountCurrencyCode)}</span>
                          </div>
                        )}
                        {legacyTaxAmounts.getfund > 0 && (
                          <div className="flex justify-between items-center text-xs text-slate-500">
                            <span>GETFund (2.5%)</span>
                            <span className="tabular-nums">{formatMoney(legacyTaxAmounts.getfund, amountCurrencyCode)}</span>
                          </div>
                        )}
                      </>
                    )}
                    <div className="flex justify-between items-center text-xs text-slate-500">
                      <span>VAT</span>
                      <span className="tabular-nums">{formatMoney(legacyTaxAmounts.vat, amountCurrencyCode)}</span>
                    </div>

                    {/* Realtime Breakdown Block */}
                    <div className="mt-2 bg-slate-50 rounded p-2 text-[10px] text-slate-600">
                      <div className="flex justify-between mb-1">
                        <span>Base Amount:</span>
                        <span className="tabular-nums">{formatMoney(baseSubtotal, amountCurrencyCode)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Tax Component:</span>
                        <span className="tabular-nums">{formatMoney(tax, amountCurrencyCode)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Grand Total */}
                <div className="flex justify-between items-center pt-2">
                  <span className="text-base font-bold text-slate-900">Total</span>
                  <span className="text-xl font-bold text-slate-900 tabular-nums">
                    {formatMoney(total, amountCurrencyCode)}
                  </span>
                </div>

                {/* WHT Receivable — customer withholds tax */}
                <div className={`mt-4 rounded-lg border p-4 ${applyWHTReceivable ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-semibold text-slate-800">Customer will deduct WHT</span>
                      <p className="text-xs text-slate-500 mt-0.5">Withheld amount recorded as tax credit (account 2155) when paid</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={applyWHTReceivable}
                      onClick={() => setApplyWHTReceivable(!applyWHTReceivable)}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${applyWHTReceivable ? "bg-amber-500" : "bg-slate-300"}`}
                    >
                      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${applyWHTReceivable ? "translate-x-5" : "translate-x-0"}`} />
                    </button>
                  </div>
                  {applyWHTReceivable && (
                    <div className="mt-3 space-y-2">
                      <NativeSelect
                        value={whtReceivableRateCode}
                        onChange={(e) => setWhtReceivableRateCode(e.target.value)}
                        className="border-amber-300 bg-white focus:border-amber-400 focus:ring-amber-400/40 dark:bg-slate-800"
                        size="sm"
                      >
                        {GH_WHT_RATES.map(r => (
                          <option key={r.code} value={r.code}>{r.name}</option>
                        ))}
                      </NativeSelect>
                      <div className="flex justify-between text-sm">
                        <span className="text-amber-700">WHT deducted:</span>
                        <span className="font-semibold text-amber-800 tabular-nums">
                          {formatMoney(whtRecvCalc.whtAmount, amountCurrencyCode)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Net you receive:</span>
                        <span className="font-bold text-slate-900 tabular-nums">
                          {formatMoney(whtRecvCalc.netPayable, amountCurrencyCode)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 5. Sticky Action Footer */}
          <div className="mt-8 flex items-center justify-end gap-3 sticky bottom-4 z-10">
            <button
              onClick={() => router.back()}
              className="px-4 py-2 bg-white border border-slate-300 rounded shadow-sm text-slate-700 text-sm font-medium hover:bg-slate-50"
            >
              Cancel
            </button>
            <div className="h-6 w-px bg-slate-300 mx-1"></div>
            <button
              onClick={() => handleSave('draft')}
              disabled={loading || items.length === 0 || !selectedCustomerId}
              className="px-5 py-2 bg-white border border-slate-300 rounded shadow-sm text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? "Saving..." : "Save Draft"}
            </button>

            <button
              onClick={async () => {
                // PREVIEW LOGIC
                if (!validateForm()) return

                // Construct preview data
                const previewData = {
                  business_id: businessId,
                  customer_id: selectedCustomerId,
                  issue_date: issueDate,
                  due_date: dueDate || null,
                  notes: notes || null,
                  footer_message: "",
                  apply_taxes: applyGhanaTax,
                  items: items.map(item => ({
                    description: item.description || "",
                    qty: Number(item.quantity) || 0,
                    unit_price: Number(item.price) || 0,
                    discount_amount: getDiscountAmount(item),
                  })),
                  // Use FX currency when FX is enabled; fall back to home currency
                  currency_symbol: fxEnabled && fxCurrencyCode
                    ? (getCurrencySymbol(fxCurrencyCode) || fxCurrencyCode)
                    : currencySymbol,
                  currency_code: fxEnabled && fxCurrencyCode ? fxCurrencyCode : currencyCode,
                  // Pass FX rate so preview-draft can compute home_currency_total
                  ...(fxEnabled && fxCurrencyCode && fxRate ? {
                    fx_rate: parseFloat(fxRate),
                  } : {}),
                  // WHT — so the preview PDF shows the deduction and net payable line
                  ...(applyWHTReceivable && whtRecvCalc.whtAmount > 0 ? {
                    wht_applicable: true,
                    wht_rate:       selectedWHTRecvRate?.rate ?? 0,
                  } : {}),
                };
                (window as any).__previewData = previewData
                setPreviewInvoiceId("preview")
                setShowPreviewModal(true)
              }}
              disabled={loading || items.length === 0 || !selectedCustomerId}
              className="px-5 py-2 bg-slate-50 border border-slate-200 text-slate-600 rounded shadow-sm text-sm font-medium hover:bg-slate-100 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
              Preview
            </button>

            <button
              onClick={() => handleSave('sent')}
              disabled={loading || items.length === 0 || !selectedCustomerId}
              className="px-6 py-2 bg-slate-900 border border-transparent rounded shadow text-white text-sm font-medium hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? "Processing..." : "Finalize & Send"}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
            </button>
          </div>

          {/* --- Modals Helper --- */}

          {showCustomerModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              {/* Backdrop */}
              <div className="absolute inset-0 bg-black/60" onClick={() => setShowCustomerModal(false)} />
              {/* Panel — stopPropagation prevents clicks inside from reaching the backdrop */}
              <div
                className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6"
                onClick={e => e.stopPropagation()}
              >
                <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">New Customer</h3>
                {customerError && <div className="text-red-600 text-sm bg-red-50 dark:bg-red-900/20 p-2 rounded mb-4">{customerError}</div>}
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name <span className="text-red-500">*</span></label>
                    <input autoFocus type="text" value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                    <input type="text" inputMode="email" value={newCustomerEmail} onChange={e => setNewCustomerEmail(e.target.value)} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone</label>
                    <input type="text" inputMode="tel" value={newCustomerPhone} onChange={e => setNewCustomerPhone(e.target.value)} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Address</label>
                    <textarea value={newCustomerAddress} onChange={e => setNewCustomerAddress(e.target.value)} rows={2} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">TIN</label>
                    <input type="text" value={newCustomerTin} onChange={e => setNewCustomerTin(e.target.value)} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">WhatsApp</label>
                    <input type="text" inputMode="tel" value={newCustomerWhatsapp} onChange={e => setNewCustomerWhatsapp(e.target.value)} placeholder="Optional if same as phone" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button type="button" onClick={() => setShowCustomerModal(false)} className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">Cancel</button>
                    <button
                      type="button"
                      disabled={creatingCustomer || !newCustomerName.trim()}
                      onClick={e => { e.stopPropagation(); handleCreateCustomer() }}
                      className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {creatingCustomer ? "Creating..." : "Create Customer"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {showPreviewModal && previewInvoiceId && (
            <InvoicePreviewModal
              invoiceId={previewInvoiceId}
              isOpen={showPreviewModal}
              onClose={() => { setShowPreviewModal(false); if (previewInvoiceId === "preview") delete (window as any).__previewData; }}
              previewData={previewInvoiceId === "preview" ? (window as any).__previewData : undefined}
            />
          )}

          {showSendChoiceModal && createdInvoiceId && (
            <SendInvoiceChoiceModal
              invoiceId={createdInvoiceId}
              customer={createdInvoiceCustomer}
              onSend={async (method) => {
                if (!createdInvoiceId) return
                setLoading(true)
                const needsWaPrep = method === "whatsapp" || method === "both"
                const waPrep = needsWaPrep ? window.open("about:blank", "_blank") : null
                try {
                  const response = await fetch(`/api/invoices/${createdInvoiceId}/send`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      ...(businessId.trim() ? { business_id: businessId.trim() } : {}),
                      sendMethod: method,
                      sendWhatsApp: method === "whatsapp" || method === "both",
                      sendEmail: method === "email" || method === "both",
                      copyLink: method === "link",
                      email: createdInvoiceCustomer?.email || "",
                    }),
                  })
                  const data = await response.json().catch(() => ({} as Record<string, unknown>))
                  if (!response.ok) {
                    if (waPrep && !waPrep.closed) {
                      try {
                        waPrep.close()
                      } catch {
                        /* ignore */
                      }
                    }
                    throw new Error(
                      (typeof data.error === "string" && data.error) ||
                        (typeof data.message === "string" && data.message) ||
                        "Failed to send"
                    )
                  }

                  if (method === "link" && typeof data.publicUrl === "string" && data.publicUrl) {
                    try {
                      await navigator.clipboard.writeText(data.publicUrl)
                      setToast({ message: "Public link copied to clipboard.", type: "success", duration: 2800 })
                    } catch {
                      setToast({
                        message: "Link is ready on the invoice page if copy failed.",
                        type: "info",
                        duration: 5000,
                      })
                    }
                  }

                  if (needsWaPrep) {
                    const waUrl = typeof data.whatsappUrl === "string" ? data.whatsappUrl : ""
                    if (waUrl) {
                      const result = openWhatsAppUrlInBrowser(waUrl, waPrep)
                      const whatsappOpened = result !== false
                      if (!whatsappOpened) {
                        setToast({
                          message:
                            "Invoice sent. If WhatsApp did not open, your browser may have blocked it — open the invoice and use Send / WhatsApp from there.",
                          type: "info",
                          duration: 9500,
                        })
                      }
                    } else if (waPrep && !waPrep.closed) {
                      try {
                        waPrep.close()
                      } catch {
                        /* ignore */
                      }
                    }
                  }

                  setShowSendChoiceModal(false)
                  router.push(invoiceViewHref(createdInvoiceId))
                } catch (e: any) {
                  setError(e?.message || "Failed to send")
                } finally {
                  setLoading(false)
                }
              }}
              onSkip={() => {
                setShowSendChoiceModal(false)
                router.push(invoiceViewHref(createdInvoiceId))
              }}
            />
          )}

          {toast && (
            <Toast
              message={toast.message}
              type={toast.type}
              duration={toast.duration}
              onClose={() => setToast(null)}
            />
          )}
        </div>
      </div>
    </Wrapper>
  )
}
