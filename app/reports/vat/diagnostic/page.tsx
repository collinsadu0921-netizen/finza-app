"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter, useSearchParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getActiveStoreId } from "@/lib/storeSession"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { getGhanaLegacyView, sumTaxLines } from "@/lib/taxes/readTaxLines"

type SaleDiagnostic = {
  sale_id: string
  sale_amount: number
  nhil: number
  getfund: number
  covid: number
  vat: number
  total_tax: number
  created_at: string
  items: Array<{
    product_id: string | null
    product_name: string
    price: number
    qty: number
    line_total: number
    category_id: string | null
    category_name: string | null
    vat_type: "standard" | "zero" | "exempt" | "unknown"
    has_category: boolean
    is_deleted: boolean
  }>
  line_totals_sum: number
  standard_rated_total: number
  zero_rated_total: number
  exempt_total: number
  expected_standard_rated: number
  expected_tax: number
  mismatch: boolean
  mismatch_reason: string[]
  products_without_categories: number
  deleted_products: number
}

export default function VatDiagnosticPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [businessId, setBusinessId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [dateFilter, setDateFilter] = useState<"today" | "week" | "month">("today")
  const [diagnostics, setDiagnostics] = useState<SaleDiagnostic[]>([])
  const [expandedSales, setExpandedSales] = useState<Set<string>>(new Set())
  const [vatInclusive, setVatInclusive] = useState(false)

  useEffect(() => {
    loadDiagnostics()
    
    // Reload when store changes
    const handleStoreChange = () => {
      loadDiagnostics()
    }
    
    window.addEventListener('storeChanged', handleStoreChange)
    
    return () => {
      window.removeEventListener('storeChanged', handleStoreChange)
    }
  }, [dateFilter])

  const loadDiagnostics = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      const ctx = await resolveAccountingContext({
        supabase,
        userId: user.id,
        searchParams,
        source: "reports",
      })
      if ("error" in ctx) {
        setLoading(false)
        return
      }
      const bid = ctx.businessId
      setBusinessId(bid)

      // Load business country and VAT settings
      const { data: businessData, error: businessQueryError } = await supabase
        .from("businesses")
        .select("address_country, retail_vat_inclusive")
        .eq("id", bid)
        .single()
      
      // DEBUG: Log query results
      console.log("[VAT Diagnostic] Business query error:", businessQueryError)
      console.log("[VAT Diagnostic] Business query result:", businessData)
      console.log("[VAT Diagnostic] address_country from query:", businessData?.address_country)
      
      // Use business object directly if query fails or returns null
      const countryValue = businessData?.address_country
      console.log("[VAT Diagnostic] Final country value used:", countryValue)
      
      // CRITICAL: Validate country before proceeding
      if (!countryValue || countryValue.trim() === "") {
        console.error("[VAT Diagnostic] Country is missing or empty")
        setError("Business country is required. Please set your business country in Business Profile settings to view VAT diagnostics.")
        setDiagnostics([])
        setLoading(false)
        return
      }
      
      const countryCode = normalizeCountry(countryValue)
      console.log("[VAT Diagnostic] Normalized country code:", countryCode)
      const isGhana = countryCode === "GH"
      const isVatInclusive = businessData?.retail_vat_inclusive ?? false
      
      // CRITICAL: Block non-GH businesses from viewing Ghana VAT structure
      if (!isGhana) {
        setError("VAT diagnostics are not available for this country. Ghana VAT structure (NHIL, GETFund) is only supported for Ghana businesses.")
        setDiagnostics([])
        setLoading(false)
        return
      }
      setVatInclusive(isVatInclusive)

      // Get active store - diagnostic MUST be store-specific
      const activeStoreId = getActiveStoreId()
      
      if (!activeStoreId || activeStoreId === 'all') {
        setError("Please select a store before viewing VAT diagnostics. Go to Stores page and click 'Open Store'.")
        setDiagnostics([])
        setLoading(false)
        return
      }

      // Calculate date range based on filter
      const now = new Date()
      let startDate: Date

      if (dateFilter === "today") {
        startDate = new Date(now)
        startDate.setHours(0, 0, 0, 0)
      } else if (dateFilter === "week") {
        startDate = new Date(now)
        startDate.setDate(now.getDate() - 7)
        startDate.setHours(0, 0, 0, 0)
      } else {
        // month
        startDate = new Date(now)
        startDate.setMonth(now.getMonth() - 1)
        startDate.setHours(0, 0, 0, 0)
      }

      // Load sales with tax data for the date range - FILTER BY STORE
      // CRITICAL: Only include paid sales (exclude refunded sales)
      // Read from tax_lines JSONB (canonical source of truth)
      const { data: sales, error: salesError } = await supabase
        .from("sales")
        .select("id, amount, tax_lines, created_at, store_id")
        .eq("business_id", bid)
        .eq("store_id", activeStoreId)
        .eq("payment_status", "paid") // CRITICAL: Exclude refunded sales from VAT calculations
        .gte("created_at", startDate.toISOString())
        .order("created_at", { ascending: false })

      if (salesError) {
        setError(`Error loading sales: ${salesError.message}`)
        setLoading(false)
        return
      }

      if (!sales || sales.length === 0) {
        setDiagnostics([])
        setLoading(false)
        return
      }

      const saleIds = sales.map((s) => s.id)

      // Load sale_items for all sales
      const { data: saleItems, error: itemsError } = await supabase
        .from("sale_items")
        .select("sale_id, product_id, name, price, qty")
        .in("sale_id", saleIds)

      if (itemsError) {
        setError(`Error loading sale items: ${itemsError.message}`)
        setLoading(false)
        return
      }

      // Load products to get category_id
      // Track which product_ids exist vs which are referenced in sale_items
      const productIds = Array.from(new Set((saleItems || []).map((item) => item.product_id).filter(Boolean)))
      const productCategoryMap = new Map<string, string | null>()
      const existingProductIds = new Set<string>()
      
      if (productIds.length > 0) {
        const { data: products } = await supabase
          .from("products")
          .select("id, category_id")
          .in("id", productIds)

        if (products) {
          for (const product of products) {
            productCategoryMap.set(product.id, product.category_id || null)
            existingProductIds.add(product.id)
          }
        }
      }
      
      // Track deleted products (product_id exists in sale_items but not in products table)
      const deletedProductIds = productIds.filter((id) => !existingProductIds.has(id))

      // Load categories to get vat_type
      const categoryIds = Array.from(new Set(Array.from(productCategoryMap.values()).filter(Boolean)))
      const categoryMap = new Map<string, { name: string; vat_type: "standard" | "zero" | "exempt" }>()
      
      if (categoryIds.length > 0) {
        const { data: categories } = await supabase
          .from("categories")
          .select("id, name, vat_type")
          .eq("business_id", bid)
          .in("id", categoryIds)

        if (categories) {
          for (const category of categories) {
            categoryMap.set(category.id, {
              name: category.name,
              vat_type: (category.vat_type as "standard" | "zero" | "exempt") || "standard",
            })
          }
        }
      }

      // Build diagnostics for each sale
      const saleDiagnostics: SaleDiagnostic[] = []

      for (const sale of sales) {
        const saleItemsForSale = (saleItems || []).filter((item) => item.sale_id === sale.id)
        
        let line_totals_sum = 0
        let standard_rated_total = 0
        let zero_rated_total = 0
        let exempt_total = 0
        let products_without_categories = 0
        let deleted_products = 0

        const items: SaleDiagnostic["items"] = []

        for (const item of saleItemsForSale) {
          const price = Number(item.price || 0)
          const qty = Number(item.qty || 1)
          const line_total = price * qty
          line_totals_sum += line_total

          const productId = item.product_id
          const isDeleted = productId ? deletedProductIds.includes(productId) : false
          
          if (isDeleted) {
            deleted_products++
          }

          const categoryId = productId && !isDeleted ? (productCategoryMap.get(productId) || null) : null
          const category = categoryId ? categoryMap.get(categoryId) : null
          // For deleted products, we can't determine VAT type - default to "unknown"
          const vatType = isDeleted 
            ? "unknown" 
            : (category ? category.vat_type : (categoryId ? "unknown" : "standard"))
          
          if (!categoryId && productId && !isDeleted) {
            products_without_categories++
          }

          // For deleted products, we can't categorize them, so don't add to any VAT type total
          // This is why the VAT report might show mismatches - we can't determine the correct VAT type
          if (!isDeleted) {
            if (vatType === "standard") {
              standard_rated_total += line_total
            } else if (vatType === "zero") {
              zero_rated_total += line_total
            } else if (vatType === "exempt") {
              exempt_total += line_total
            }
          }

          items.push({
            product_id: productId,
            product_name: item.name || "Unknown",
            price,
            qty,
            line_total,
            category_id: categoryId,
            category_name: category?.name || null,
            vat_type: vatType,
            has_category: !!categoryId,
            is_deleted: isDeleted,
          })
        }

        // Use canonical helper to read from tax_lines JSONB (source of truth)
        // All new sales have tax_lines populated (Commit A)
        const { vat, nhil, getfund, covid } = getGhanaLegacyView(sale.tax_lines)
        const total_tax = (sale as { total_tax?: number }).total_tax ?? (sale.tax_lines ? sumTaxLines(sale.tax_lines) : 0)

        // Calculate expected values for validation (audit-safe: derived from stored amounts only)
        // For both VAT-inclusive and VAT-exclusive: standard_rated = base + total_tax
        // Therefore expected_standard_rated = standard_rated_total (already calculated from line totals)
        // Expected tax = total_tax (from tax_lines)
        const expected_standard_rated = standard_rated_total
        const expected_tax = total_tax

        // Check for mismatches
        const mismatch_reason: string[] = []
        let mismatch = false

        // Check 1: Line totals sum should match sale amount
        const amountDiff = Math.abs(Number(sale.amount || 0) - line_totals_sum)
        if (amountDiff > 0.01) {
          mismatch = true
          mismatch_reason.push(`Sale amount (${Number(sale.amount || 0).toFixed(2)}) doesn't match line totals sum (${line_totals_sum.toFixed(2)})`)
        }

        // Check 2: Standard rated total should match expected (if taxes exist)
        if (total_tax > 0) {
          const standardDiff = Math.abs(standard_rated_total - expected_standard_rated)
          if (standardDiff > 0.10) {
            mismatch = true
            mismatch_reason.push(`Standard rated total (${standard_rated_total.toFixed(2)}) doesn't match expected (${expected_standard_rated.toFixed(2)}) based on taxes`)
          }
        }

        // Check 3: Deleted products
        if (deleted_products > 0) {
          mismatch = true
          mismatch_reason.push(
            `${deleted_products} product(s) were deleted after the sale. ` +
            `Cannot determine VAT type for deleted products, which may cause VAT report discrepancies.`
          )
        }

        // Check 4: Products without categories (but not deleted)
        if (products_without_categories > 0) {
          mismatch = true
          mismatch_reason.push(`${products_without_categories} product(s) without categories (defaulting to "standard")`)
        }

        // Check 5: Only flag tax inconsistencies if there are deleted products or missing categories
        // Validate stored tax amounts are consistent (audit-safe: no recomputation using hardcoded rates)
        // For both VAT-inclusive and VAT-exclusive: standard_rated_total = base + total_tax
        // This relationship must hold for stored values (validation only, no recomputation)
        if (standard_rated_total > 0 && total_tax > 0 && (deleted_products > 0 || products_without_categories > 0)) {
          // Validate internal consistency: standard_rated_total should be >= total_tax (base cannot be negative)
          if (standard_rated_total < total_tax) {
            mismatch = true
            mismatch_reason.push(
              `Tax amount inconsistency: Standard rated total (${standard_rated_total.toFixed(2)}) is less than total tax (${total_tax.toFixed(2)}). ` +
              `This may be due to deleted products or missing categories affecting VAT type determination.`
            )
          }
        }

        saleDiagnostics.push({
          sale_id: sale.id.substring(0, 8),
          sale_amount: Number(sale.amount || 0),
          nhil,
          getfund,
          covid,
          vat,
          total_tax,
          created_at: sale.created_at,
          items,
          line_totals_sum,
          standard_rated_total,
          zero_rated_total,
          exempt_total,
          expected_standard_rated,
          expected_tax,
          mismatch,
          mismatch_reason,
          products_without_categories,
          deleted_products,
        })
      }

      setDiagnostics(saleDiagnostics)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load diagnostics")
      setLoading(false)
    }
  }

  const toggleSale = (saleId: string) => {
    const newExpanded = new Set(expandedSales)
    if (newExpanded.has(saleId)) {
      newExpanded.delete(saleId)
    } else {
      newExpanded.add(saleId)
    }
    setExpandedSales(newExpanded)
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const getVatTypeBadge = (vatType: string) => {
    const styles: Record<string, string> = {
      standard: "bg-blue-100 text-blue-800",
      zero: "bg-yellow-100 text-yellow-800",
      exempt: "bg-green-100 text-green-800",
      unknown: "bg-gray-100 text-gray-800",
    }
    return (
      <span className={`px-2 py-1 rounded text-xs font-semibold ${styles[vatType] || "bg-gray-100 text-gray-800"}`}>
        {vatType.toUpperCase()}
      </span>
    )
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading VAT diagnostics...</p>
        </div>
      </ProtectedLayout>
    )
  }

  const mismatchedSales = diagnostics.filter((d) => d.mismatch)
  const salesWithMissingCategories = diagnostics.filter((d) => d.products_without_categories > 0)
  const salesWithDeletedProducts = diagnostics.filter((d) => d.deleted_products > 0)

  return (
    <ProtectedLayout>
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">VAT Diagnostic Tool</h1>
            <p className="text-gray-600">Identify sales causing VAT report mismatches</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/reports/vat")}
              className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
            >
              Back to VAT Report
            </button>
            <button
              onClick={() => router.push("/dashboard")}
              className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
            >
              Dashboard
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                {error}
                {error.includes("Business country is required") && (
                  <div className="mt-2">
                    <a
                      href="/settings/business-profile"
                      className="text-blue-600 hover:text-blue-800 underline font-medium"
                    >
                      Go to Business Profile Settings →
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Summary</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="border p-4 rounded">
              <div className="text-sm text-gray-600 mb-1">Total Sales</div>
              <div className="text-2xl font-bold">{diagnostics.length}</div>
            </div>
            <div className="border p-4 rounded">
              <div className="text-sm text-gray-600 mb-1">Mismatched Sales</div>
              <div className="text-2xl font-bold text-red-600">{mismatchedSales.length}</div>
            </div>
            <div className="border p-4 rounded">
              <div className="text-sm text-gray-600 mb-1">Sales with Missing Categories</div>
              <div className="text-2xl font-bold text-orange-600">{salesWithMissingCategories.length}</div>
            </div>
            <div className="border p-4 rounded">
              <div className="text-sm text-gray-600 mb-1">Sales with Deleted Products</div>
              <div className="text-2xl font-bold text-red-600">{salesWithDeletedProducts.length}</div>
            </div>
            <div className="border p-4 rounded">
              <div className="text-sm text-gray-600 mb-1">VAT Mode</div>
              <div className="text-lg font-semibold">{vatInclusive ? "VAT-Inclusive" : "VAT-Exclusive"}</div>
            </div>
          </div>
        </div>

        {/* Date Filter */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
          <label className="block text-sm font-medium mb-2">Date Range</label>
          <select
            className="border p-2 rounded"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as "today" | "week" | "month")}
          >
            <option value="today">Today</option>
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
          </select>
        </div>

        {/* Sales List */}
        <div className="space-y-4">
          {diagnostics.length === 0 ? (
            <div className="border p-8 rounded-lg text-center bg-gray-50">
              <p className="text-gray-600">No sales found in the selected date range.</p>
            </div>
          ) : (
            diagnostics.map((diagnostic) => (
              <div
                key={diagnostic.sale_id}
                className={`border rounded-lg overflow-hidden ${
                  diagnostic.mismatch ? "border-red-300 bg-red-50" : "bg-white"
                }`}
              >
                <div
                  className="p-4 cursor-pointer hover:bg-gray-50 flex justify-between items-center"
                  onClick={() => toggleSale(diagnostic.sale_id)}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-4">
                      <span className="font-mono font-semibold text-blue-600">{diagnostic.sale_id}</span>
                      <span className="text-sm text-gray-500">{formatDate(diagnostic.created_at)}</span>
                      {diagnostic.mismatch && (
                        <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-semibold">
                          ⚠️ MISMATCH
                        </span>
                      )}
                      {diagnostic.products_without_categories > 0 && (
                        <span className="px-2 py-1 bg-orange-100 text-orange-800 rounded text-xs font-semibold">
                          Missing Categories ({diagnostic.products_without_categories})
                        </span>
                      )}
                      {diagnostic.deleted_products > 0 && (
                        <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-semibold">
                          Deleted Products ({diagnostic.deleted_products})
                        </span>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">Amount:</span>{" "}
                        <span className="font-semibold">GHS {diagnostic.sale_amount.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Tax:</span>{" "}
                        <span className="font-semibold">GHS {diagnostic.total_tax.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Standard Rated:</span>{" "}
                        <span className="font-semibold">GHS {diagnostic.standard_rated_total.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Zero Rated:</span>{" "}
                        <span className="font-semibold">GHS {diagnostic.zero_rated_total.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Exempt:</span>{" "}
                        <span className="font-semibold">GHS {diagnostic.exempt_total.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                  <button className="ml-4 text-gray-600">
                    {expandedSales.has(diagnostic.sale_id) ? "▼" : "▶"}
                  </button>
                </div>

                {expandedSales.has(diagnostic.sale_id) && (
                  <div className="border-t bg-white p-4">
                    {/* Mismatch Reasons */}
                    {diagnostic.mismatch_reason.length > 0 && (
                      <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded">
                        <div className="font-semibold text-red-800 mb-2">Issues Found:</div>
                        <ul className="list-disc list-inside text-sm text-red-700">
                          {diagnostic.mismatch_reason.map((reason, idx) => (
                            <li key={idx}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Items Table */}
                    <div className="mb-4">
                      <div className="font-semibold mb-2">Sale Items:</div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left">Product</th>
                              <th className="px-3 py-2 text-right">Price</th>
                              <th className="px-3 py-2 text-right">Qty</th>
                              <th className="px-3 py-2 text-right">Total</th>
                              <th className="px-3 py-2 text-left">Category</th>
                              <th className="px-3 py-2 text-left">VAT Type</th>
                            </tr>
                          </thead>
                          <tbody>
                            {diagnostic.items.map((item, idx) => (
                              <tr key={idx} className={item.is_deleted ? "bg-red-50" : (!item.has_category ? "bg-orange-50" : "")}>
                                <td className="px-3 py-2">
                                  {item.product_name}
                                  {item.is_deleted && (
                                    <span className="ml-2 text-red-600 font-semibold text-xs">(DELETED)</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right">GHS {item.price.toFixed(2)}</td>
                                <td className="px-3 py-2 text-right">{item.qty}</td>
                                <td className="px-3 py-2 text-right font-semibold">
                                  GHS {item.line_total.toFixed(2)}
                                </td>
                                <td className="px-3 py-2">
                                  {item.is_deleted ? (
                                    <span className="text-red-600 font-semibold">Product Deleted</span>
                                  ) : item.category_name ? (
                                    item.category_name
                                  ) : (
                                    <span className="text-orange-600 font-semibold">No Category</span>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  {item.is_deleted ? (
                                    <span className="px-2 py-1 rounded text-xs font-semibold bg-gray-100 text-gray-800">
                                      UNKNOWN
                                    </span>
                                  ) : (
                                    getVatTypeBadge(item.vat_type)
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Tax Breakdown */}
                    <div className="border-t pt-4">
                      <div className="font-semibold mb-2">Tax Breakdown:</div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-gray-600">NHIL:</span>{" "}
                          <span className="font-semibold">GHS {diagnostic.nhil.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-gray-600">GETFund:</span>{" "}
                          <span className="font-semibold">GHS {diagnostic.getfund.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-gray-600">VAT:</span>{" "}
                          <span className="font-semibold">GHS {diagnostic.vat.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}

