"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { supabase } from "@/lib/supabaseClient"
import { getUserRole } from "@/lib/userRoles"
import { getActiveStoreId } from "@/lib/storeSession"
import { ensureProductsStockRow } from "@/lib/productsStock"
import { cn } from "@/lib/utils"
import {
  retailFieldClass,
  retailLabelClass,
  RetailBackofficeBadge,
  RetailBackofficeCard,
} from "@/components/retail/RetailBackofficeUi"

const ADJUSTMENT_REASON_OPTIONS = [
  { value: "supplier_delivery", label: "Supplier delivery / restock" },
  { value: "damaged", label: "Damaged or spoilage" },
  { value: "shrinkage", label: "Shrinkage / theft" },
  { value: "found", label: "Found / recovered stock" },
  { value: "cycle_count", label: "Cycle count correction" },
  { value: "customer_return", label: "Customer return to shelf" },
  { value: "transfer", label: "Store transfer" },
  { value: "other", label: "Other (describe in note)" },
] as const

type StockAdjustmentModalProps = {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  product: {
    id: string
    name: string
    stock_quantity?: number
    stock?: number
  }
  businessId: string
  userId: string
  variantId?: string | null
  variantName?: string
  presentation?: "modal" | "inline"
  /** Shown in summary when provided (e.g. from add-stock page) */
  productBarcode?: string | null
}

type AdjustmentType = "add" | "remove" | "correct"

export default function StockAdjustmentModal({
  isOpen,
  onClose,
  onSuccess,
  product,
  businessId,
  userId,
  variantId = null,
  variantName,
  presentation = "modal",
  productBarcode = null,
}: StockAdjustmentModalProps) {
  const inline = presentation === "inline"
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>("add")
  const [quantity, setQuantity] = useState("")
  const [adjustmentReason, setAdjustmentReason] = useState<string>("")
  const [note, setNote] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [hasPermission, setHasPermission] = useState(false)
  const [checkingPermission, setCheckingPermission] = useState(true)

  // Current stock state - will be loaded from products_stock for active store
  const [currentStock, setCurrentStock] = useState(0)

  const previewQty = useMemo(() => {
    const s = String(quantity ?? "").replace(/[^\d]/g, "")
    if (s === "") return null
    const n = parseInt(s, 10)
    return Number.isNaN(n) ? null : n
  }, [quantity])

  const projectedNewStock = useMemo(() => {
    if (previewQty === null) return null
    if (adjustmentType === "add") return currentStock + previewQty
    if (adjustmentType === "remove") return Math.max(0, currentStock - previewQty)
    return previewQty
  }, [previewQty, adjustmentType, currentStock])

  // Load current stock from products_stock for active store
  const loadCurrentStock = useCallback(async () => {
    try {
      const activeStoreId = getActiveStoreId()
      
      if (!activeStoreId || activeStoreId === 'all') {
        setCurrentStock(0)
        setError("Please select a store before adjusting stock")
        return
      }

      // Get stock from products_stock for this product and store (and variant if provided)
      const query = supabase
        .from("products_stock")
        .select("stock, stock_quantity")
        .eq("product_id", product.id)
        .eq("store_id", activeStoreId)
      
      if (variantId) {
        query.eq("variant_id", variantId)
      } else {
        query.is("variant_id", null)
      }
      
      const { data: stockRecord, error } = await query.maybeSingle()

      if (error && error.code !== "PGRST116") {
        console.error("Error loading stock:", error)
        setCurrentStock(0)
        return
      }

      // Use stock_quantity if available, otherwise stock, otherwise 0
      const stock = stockRecord
        ? Math.floor(
            stockRecord.stock_quantity !== null && stockRecord.stock_quantity !== undefined
              ? Number(stockRecord.stock_quantity)
              : stockRecord.stock !== null && stockRecord.stock !== undefined
              ? Number(stockRecord.stock)
              : 0
          )
        : 0

      setCurrentStock(stock)
      console.log("Stock Adjustment Modal - Loaded stock from products_stock:", {
        productId: product.id,
        storeId: activeStoreId,
        stock,
      })
    } catch (err) {
      console.error("Error loading current stock:", err)
      setCurrentStock(0)
    }
  }, [product.id, variantId])

  const checkPermission = useCallback(async () => {
    try {
      setCheckingPermission(true)
      const role = await getUserRole(supabase, userId, businessId)
      if (role === "owner" || role === "admin" || role === "manager") {
        setHasPermission(true)
      } else {
        setHasPermission(false)
        setError("Only owners, admins, and managers can adjust stock")
      }
    } catch (err) {
      setError("Failed to verify permissions")
      setHasPermission(false)
    } finally {
      setCheckingPermission(false)
    }
  }, [userId, businessId])

  useEffect(() => {
    if (isOpen) {
      // Reset form first
      setAdjustmentType("add")
      setQuantity("")
      setAdjustmentReason("")
      setNote("")
      setError("")
      setCurrentStock(0)
      // Then check permissions and load stock
      checkPermission()
      loadCurrentStock()
    } else {
      // Reset state when modal closes
      setError("")
      setCurrentStock(0)
      setQuantity("")
      setAdjustmentReason("")
      setNote("")
    }
  }, [isOpen, checkPermission, loadCurrentStock])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!hasPermission) {
      setError("You do not have permission to adjust stock")
      return
    }

    // Parse quantity as a clean integer - ensure no multiplication or string concatenation
    // First, ensure we have a valid string input
    const quantityStr = String(quantity || "").trim()
    if (!adjustmentReason) {
      setError("Please select a reason for this adjustment")
      return
    }

    if (!quantityStr) {
      setError("Quantity is required")
      return
    }
    
    // Remove any non-numeric characters (keep only digits)
    const cleanQuantity = quantityStr.replace(/[^\d]/g, "")
    if (!cleanQuantity) {
      setError("Quantity must be a valid number")
      return
    }
    
    // Parse as base-10 integer - this ensures no multiplication or string concatenation
    const qty = parseInt(cleanQuantity, 10)
    
    // Validate the parsed quantity (correction may be zero)
    if (adjustmentType === "correct") {
      if (isNaN(qty) || qty < 0 || !Number.isInteger(qty)) {
        setError("Corrected stock must be a whole number (0 or more)")
        return
      }
    } else if (isNaN(qty) || qty <= 0 || !Number.isInteger(qty)) {
      setError("Quantity must be a positive whole number")
      return
    }
    
    // Debug: Log quantity parsing
    console.log("Stock Adjustment - Quantity Parsing:", {
      input: quantity,
      cleaned: cleanQuantity,
      parsed: qty,
      isInteger: Number.isInteger(qty),
    })

    // Validate remove stock
    if (adjustmentType === "remove" && qty > currentStock) {
      setError(`Cannot remove ${qty} items. Current stock is only ${currentStock}`)
      return
    }

    try {
      setLoading(true)
      
      // Get active store ID
      const activeStoreId = getActiveStoreId()
      
      if (!activeStoreId || activeStoreId === 'all') {
        throw new Error("Please select a store before adjusting stock")
      }
      
      // Check if products_stock row exists first
      let stockRowId: string | null = null
      let currentStockInDB = 0
      
      // Try to get existing stock record
      const stockQuery = supabase
        .from("products_stock")
        .select("id, stock, stock_quantity")
        .eq("product_id", product.id)
        .eq("store_id", activeStoreId)
      
      if (variantId) {
        stockQuery.eq("variant_id", variantId)
      } else {
        stockQuery.is("variant_id", null)
      }
      
      const { data: existingStockRecord } = await stockQuery.maybeSingle()

      if (existingStockRecord?.id) {
        // Row exists - use its stock value
        stockRowId = existingStockRecord.id
        currentStockInDB = Math.floor(
          existingStockRecord.stock_quantity !== null && existingStockRecord.stock_quantity !== undefined
            ? Number(existingStockRecord.stock_quantity)
            : existingStockRecord.stock !== null && existingStockRecord.stock !== undefined
            ? Number(existingStockRecord.stock)
            : 0
        )
      } else {
        // Row doesn't exist - need to create it, but first get stock from products table
        // Get current stock from products table as fallback
        const { data: productData } = await supabase
          .from("products")
        .select("stock, stock_quantity")
          .eq("id", product.id)
        .single()

        const fallbackStock = productData
        ? Math.floor(
              productData.stock_quantity !== null && productData.stock_quantity !== undefined
                ? Number(productData.stock_quantity)
                : productData.stock !== null && productData.stock !== undefined
                ? Number(productData.stock)
              : 0
          )
        : 0

        // Create products_stock row with the actual stock value (not 0)
        const { data: newStockRecord, error: createError } = await supabase
          .from("products_stock")
          .insert({
            product_id: product.id,
            store_id: activeStoreId,
            variant_id: variantId || null,
            stock: fallbackStock,
            stock_quantity: fallbackStock,
          })
          .select("id")
          .single()

        if (createError || !newStockRecord?.id) {
          throw new Error("Failed to initialize stock record for this store")
        }

        stockRowId = newStockRecord.id
        currentStockInDB = fallbackStock
      }

      // Validate remove stock against actual database stock
      if (adjustmentType === "remove" && qty > currentStockInDB) {
        setError(`Cannot remove ${qty} items. Current stock is only ${currentStockInDB}`)
        setLoading(false)
        return
      }

      // Calculate quantity change and new stock based on adjustment type
      let finalQuantityChange: number
      let newStockValue: number
      
      if (adjustmentType === "add") {
        finalQuantityChange = qty
        newStockValue = currentStockInDB + qty
      } else if (adjustmentType === "remove") {
        finalQuantityChange = -qty
        newStockValue = Math.max(0, currentStockInDB - qty)
      } else {
        // Correct: set to exact value
        finalQuantityChange = qty - currentStockInDB
        newStockValue = qty
      }

      // Debug: Log calculation
      console.log("Stock Adjustment - Calculation:", {
        adjustmentType,
        currentStockInDB,
        qty,
        newStockValue,
        finalQuantityChange,
      })

      // Update products_stock (per-store inventory)
      // CRITICAL: Ensure newStockValue is ALWAYS a proper integer, NEVER a string
      // Convert to number, then floor to ensure integer
      let finalStockValue: number
      if (typeof newStockValue === 'string') {
        // Remove any non-digit characters and parse
        const cleaned = (newStockValue as string).replace(/[^\d-]/g, '')
        finalStockValue = parseInt(cleaned, 10) || 0
      } else {
        finalStockValue = Math.floor(Number(newStockValue)) || 0
      }
      
      // Final safety check - must be integer
      finalStockValue = Math.floor(Number(finalStockValue)) || 0
      
      // Debug: Log what we're saving
      console.log("Stock Adjustment - Saving to database:", {
        productId: product.id,
        storeId: activeStoreId,
        currentStockInDB,
        qty,
        newStockValue,
        finalStockValue,
        typeOfFinal: typeof finalStockValue,
      })
      
      const { error: updateError } = await supabase
        .from("products_stock")
        .update({
          stock: finalStockValue,
          stock_quantity: finalStockValue,
        })
        .eq("id", stockRowId)

      if (updateError) {
        throw new Error(updateError.message || "Failed to update stock")
      }

      // VERIFY: Read back the saved value to confirm it was saved correctly
      const { data: verifyRecord } = await supabase
        .from("products_stock")
        .select("stock, stock_quantity")
        .eq("id", stockRowId)
        .single()

      if (verifyRecord) {
        const savedStock = Math.floor(
          verifyRecord.stock_quantity !== null && verifyRecord.stock_quantity !== undefined
            ? Number(verifyRecord.stock_quantity)
            : verifyRecord.stock !== null && verifyRecord.stock !== undefined
            ? Number(verifyRecord.stock)
            : 0
        )
        
        console.log("Stock Adjustment - Verified saved value:", {
          savedStock,
          expected: finalStockValue,
          match: savedStock === finalStockValue,
        })
        
        // If there's a mismatch, log warning but don't fail
        if (savedStock !== finalStockValue) {
          console.warn("WARNING: Stock value mismatch after save!", {
            expected: finalStockValue,
            actual: savedStock,
            difference: savedStock - finalStockValue,
          })
        }
      }

      const reasonLabel =
        ADJUSTMENT_REASON_OPTIONS.find((o) => o.value === adjustmentReason)?.label ?? adjustmentReason
      const parts = [reasonLabel, note.trim()].filter(Boolean)
      const adjustmentNote =
        parts.join(" — ") ||
        `${adjustmentType === "add" ? "Added" : adjustmentType === "remove" ? "Removed" : "Corrected"} stock: ${qty} units`

      // Create stock movement record with store_id (ALWAYS include store_id)
      const movementData: any = {
        business_id: businessId,
        product_id: product.id,
        quantity_change: finalQuantityChange, // Use the calculated change
        type: "adjustment",
        user_id: userId,
        related_sale_id: null,
        note: adjustmentNote,
        store_id: activeStoreId, // ALWAYS set store_id for adjustments
      }
      
      const { error: movementError } = await supabase
        .from("stock_movements")
        .insert(movementData)

      if (movementError) {
        console.error("Error creating stock movement:", movementError)
        // Don't fail if movement logging fails, but log it
      }

      onSuccess()
      onClose()
    } catch (err: any) {
      setError(err.message || "Failed to adjust stock")
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  const shellOuter = inline
    ? "w-full max-w-xl mx-auto"
    : "fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3 backdrop-blur-[2px] sm:p-4"
  const shellInner = inline
    ? "w-full rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.12)] sm:p-6"
    : "w-full max-w-md max-h-[min(88vh,34rem)] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_24px_48px_-12px_rgba(15,23,42,0.18)] sm:max-h-[min(90vh,36rem)] sm:p-5"

  if (checkingPermission) {
    return (
      <div className={shellOuter}>
        <div className={shellInner}>
          <p className="text-sm text-slate-600">Checking permissions…</p>
        </div>
      </div>
    )
  }

  if (!hasPermission) {
    return (
      <div className={shellOuter}>
        <div className={shellInner}>
          <h2 className="text-lg font-semibold text-slate-900">Adjust stock</h2>
          <div className="mt-4 rounded-xl border border-red-200/90 bg-red-50/90 px-4 py-3 text-sm text-red-950">
            Only owners, admins, and managers can adjust stock.
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-6 w-full rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={shellOuter}>
      <div className={shellInner}>
        <div className="mb-4 border-b border-slate-100 pb-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Stock adjustment</p>
          <h2 className="mt-1 text-base font-semibold tracking-tight text-slate-900 sm:text-lg">Adjust on-hand quantity</h2>
          <p className="mt-1.5 text-sm leading-snug text-slate-600">
            {variantId && variantName ? (
              <>
                <span className="font-medium text-slate-800">{product.name}</span>
                <span className="text-slate-400"> · </span>
                <span>{variantName}</span>
              </>
            ) : (
              <span className="font-medium text-slate-800">{product.name}</span>
            )}
          </p>
        </div>

        <RetailBackofficeCard padding="p-3 sm:p-4" className="mb-4 border-slate-100 bg-slate-50/60">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Summary</p>
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">Current on hand</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">{currentStock}</dd>
            </div>
            {productBarcode ? (
              <div>
                <dt className="text-xs text-slate-500">Barcode / SKU</dt>
                <dd className="mt-0.5 font-mono text-xs text-slate-800">{productBarcode}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs text-slate-500">This adjustment</dt>
              <dd className="mt-0.5 flex flex-wrap items-center gap-2">
                <RetailBackofficeBadge tone="neutral">
                  {adjustmentType === "add" ? "Add" : adjustmentType === "remove" ? "Remove" : "Set to"}
                </RetailBackofficeBadge>
                <span className="font-semibold tabular-nums text-slate-900">
                  {previewQty == null
                    ? "—"
                    : adjustmentType === "add"
                      ? `+${previewQty}`
                      : adjustmentType === "remove"
                        ? `−${previewQty}`
                        : String(previewQty)}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">After save (preview)</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">
                {projectedNewStock != null ? projectedNewStock : "—"}
              </dd>
            </div>
          </dl>
        </RetailBackofficeCard>

        {error && (
          <div className="mb-5 rounded-xl border border-red-200/90 bg-red-50/90 px-4 py-3 text-sm text-red-950">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <span className={retailLabelClass}>Adjustment type</span>
            <div className="mt-1.5 space-y-2 rounded-xl border border-slate-100 bg-slate-50/40 p-2.5 sm:p-3">
              <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-800">
                <input
                  type="radio"
                  value="add"
                  checked={adjustmentType === "add"}
                  onChange={(e) => setAdjustmentType(e.target.value as AdjustmentType)}
                  className="h-4 w-4 border-slate-300 text-slate-900 focus:ring-slate-400"
                />
                <span>Add to existing stock</span>
              </label>
              <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-800">
                <input
                  type="radio"
                  value="remove"
                  checked={adjustmentType === "remove"}
                  onChange={(e) => setAdjustmentType(e.target.value as AdjustmentType)}
                  className="h-4 w-4 border-slate-300 text-slate-900 focus:ring-slate-400"
                />
                <span>Remove from stock</span>
              </label>
              <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-800">
                <input
                  type="radio"
                  value="correct"
                  checked={adjustmentType === "correct"}
                  onChange={(e) => setAdjustmentType(e.target.value as AdjustmentType)}
                  className="h-4 w-4 border-slate-300 text-slate-900 focus:ring-slate-400"
                />
                <span>Set exact count (cycle count)</span>
              </label>
            </div>
          </div>

          <div>
            <label className={retailLabelClass}>
              Reason <span className="text-red-600">*</span>
            </label>
            <select
              value={adjustmentReason}
              onChange={(e) => setAdjustmentReason(e.target.value)}
              className={retailFieldClass}
              required
              disabled={loading}
            >
              <option value="">Select a reason…</option>
              {ADJUSTMENT_REASON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={retailLabelClass}>
              Quantity <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={quantity}
              onChange={(e) => {
                // Prevent any multiplication or concatenation issues
                // Get the raw input value directly from the event target
                const rawValue = e.target.value
                
                // If empty, set empty string immediately
                if (rawValue === "" || rawValue === null || rawValue === undefined) {
                  setQuantity("")
                  return
                }
                
                // Convert to string and remove any non-digit characters
                const stringValue = String(rawValue)
                const digitsOnly = stringValue.replace(/[^\d]/g, "")
                
                // Set the value exactly as entered (digits only) - no parsing, no conversion, no multiplication
                // This ensures the value is exactly what the user types, character by character
                setQuantity(digitsOnly)
              }}
              onKeyDown={(e) => {
                // Prevent any unwanted behavior on key press
                // Allow: digits, backspace, delete, arrow keys, tab, enter
                if (
                  /[0-9]/.test(e.key) ||
                  e.key === "Backspace" ||
                  e.key === "Delete" ||
                  e.key.startsWith("Arrow") ||
                  e.key === "Tab" ||
                  e.key === "Enter"
                ) {
                  return
                }
                // Prevent all other keys (prevents paste issues, etc.)
                e.preventDefault()
              }}
              className={retailFieldClass}
              placeholder={adjustmentType === "correct" ? "Enter correct stock amount" : "Enter quantity"}
              required
              disabled={loading}
            />
            {adjustmentType === "remove" && (
              <p className="text-xs text-gray-500 mt-1">
                Maximum: {currentStock} (current stock)
              </p>
            )}
            {adjustmentType === "correct" && (
              <p className="text-xs text-gray-500 mt-1">
                This will set stock to exactly this amount
              </p>
            )}
          </div>

          <div>
            <label className={retailLabelClass}>Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={cn(retailFieldClass, "min-h-[72px] resize-y")}
              rows={2}
              placeholder="Reference PO, staff initials, or context (recommended for “Other”)"
              disabled={loading}
            />
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-40"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={loading || String(quantity ?? "").trim() === "" || !adjustmentReason}
            >
              {loading ? "Saving…" : "Save adjustment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


