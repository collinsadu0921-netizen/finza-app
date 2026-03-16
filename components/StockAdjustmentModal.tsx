"use client"

import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabaseClient"
import { getUserRole } from "@/lib/userRoles"
import { getActiveStoreId } from "@/lib/storeSession"
import { ensureProductsStockRow } from "@/lib/productsStock"

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
}: StockAdjustmentModalProps) {
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>("add")
  const [quantity, setQuantity] = useState("")
  const [note, setNote] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [hasPermission, setHasPermission] = useState(false)
  const [checkingPermission, setCheckingPermission] = useState(true)

  // Current stock state - will be loaded from products_stock for active store
  const [currentStock, setCurrentStock] = useState(0)

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
  }, [product.id])

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
    
    // Validate the parsed quantity
    if (isNaN(qty) || qty <= 0 || !Number.isInteger(qty)) {
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
        const cleaned = newStockValue.replace(/[^\d-]/g, '')
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

      // Create stock movement record
      const adjustmentNote = note.trim() || `${adjustmentType === "add" ? "Added" : adjustmentType === "remove" ? "Removed" : "Corrected"} stock: ${qty} units`

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

  if (checkingPermission) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <p>Checking permissions...</p>
        </div>
      </div>
    )
  }

  if (!hasPermission) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <h2 className="text-xl font-bold mb-4">Adjust Stock</h2>
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            <p>Only owners, admins, and managers can adjust stock.</p>
          </div>
          <button
            onClick={onClose}
            className="w-full bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
          >
            Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-bold mb-4">Adjust Stock</h2>
        <p className="text-sm text-gray-600 mb-4">
          {variantId && variantName ? (
            <>Variant: {variantName} ({product.name})</>
          ) : (
            <>Product: {product.name}</>
          )}
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label className="block text-sm font-medium mb-1">Current Stock</label>
            <input
              type="text"
              value={currentStock}
              readOnly
              className="w-full border rounded px-3 py-2 bg-gray-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Adjustment Type</label>
            <div className="space-y-2">
              <label className="flex items-center">
                <input
                  type="radio"
                  value="add"
                  checked={adjustmentType === "add"}
                  onChange={(e) => setAdjustmentType(e.target.value as AdjustmentType)}
                  className="mr-2"
                />
                <span>Add Stock</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="remove"
                  checked={adjustmentType === "remove"}
                  onChange={(e) => setAdjustmentType(e.target.value as AdjustmentType)}
                  className="mr-2"
                />
                <span>Remove Stock</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="correct"
                  checked={adjustmentType === "correct"}
                  onChange={(e) => setAdjustmentType(e.target.value as AdjustmentType)}
                  className="mr-2"
                />
                <span>Correct Stock</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
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
              className="w-full border rounded px-3 py-2"
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
            <label className="block text-sm font-medium mb-1">Note (Optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full border rounded px-3 py-2"
              rows={3}
              placeholder="Reason for adjustment..."
              disabled={loading}
            />
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              disabled={loading || !quantity}
            >
              {loading ? "Processing..." : "Submit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


