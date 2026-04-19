"use client"

import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabaseClient"
import RetailBarcodeFieldWithCamera from "@/components/retail/RetailBarcodeFieldWithCamera"

type Variant = {
  id?: string
  variant_name: string
  sku: string
  price?: string
  cost_price?: string
  stock: string
  barcode?: string
}

type ProductModifier = {
  id?: string
  name: string
  price: string
}

type ProductVariantsManagerProps = {
  productId: string | null
  businessId: string
  onVariantsChange?: (variants: Variant[]) => void
  onModifiersChange?: (modifiers: ProductModifier[]) => void
}

export default function ProductVariantsManager({
  productId,
  businessId,
  onVariantsChange,
  onModifiersChange,
}: ProductVariantsManagerProps) {
  const [hasVariants, setHasVariants] = useState(false)
  const [variants, setVariants] = useState<Variant[]>([])
  const [modifiers, setModifiers] = useState<ProductModifier[]>([])
  const [loading, setLoading] = useState(false)

  const loadVariants = useCallback(async () => {
    if (!productId) return

    try {
      const { data, error } = await supabase
        .from("products_variants")
        .select("*")
        .eq("product_id", productId)
        .order("created_at", { ascending: true })

      if (error) {
        // If table doesn't exist, permission denied, or schema cache issue, just return empty
        if (
          error.code === "42P01" || 
          error.code === "42501" || 
          error.message?.includes("does not exist") ||
          error.message?.includes("schema cache") ||
          error.message?.includes("Could not find the table")
        ) {
          setHasVariants(false)
          setVariants([])
          return
        }
        throw error
      }

      if (data && data.length > 0) {
        setHasVariants(true)
        setVariants(
          data.map((v) => ({
            id: v.id,
            variant_name: v.variant_name,
            sku: v.sku || "",
            price: v.price ? v.price.toString() : "",
            cost_price: v.cost_price ? v.cost_price.toString() : "",
            stock: (v.stock_quantity || v.stock || 0).toString(),
            barcode: v.barcode || "",
          }))
        )
      } else {
        setHasVariants(false)
        setVariants([])
      }
    } catch (err: any) {
      // Handle different error types
      const errorInfo = {
        message: err?.message || (typeof err === 'string' ? err : 'Unknown error'),
        code: err?.code,
        details: err?.details,
        hint: err?.hint,
        name: err?.name,
        stack: err?.stack,
      }
      
      // Only log if it's not a "table doesn't exist" or "schema cache" error (which is expected)
      if (
        err?.code !== "42P01" && 
        err?.code !== "42501" && 
        !err?.message?.includes("does not exist") &&
        !err?.message?.includes("schema cache") &&
        !err?.message?.includes("Could not find the table")
      ) {
        console.error("Error loading variants:", errorInfo)
      }
      
      // Don't throw - just log and continue with empty variants
      setHasVariants(false)
      setVariants([])
    }
  }, [productId])

  const loadModifiers = useCallback(async () => {
    if (!productId) return

    try {
      const { data, error } = await supabase
        .from("product_modifiers")
        .select("*")
        .eq("product_id", productId)
        .order("created_at", { ascending: true })

      if (error) {
        // If table doesn't exist, permission denied, or schema cache issue, just return empty
        if (
          error.code === "42P01" || 
          error.code === "42501" || 
          error.message?.includes("does not exist") ||
          error.message?.includes("schema cache") ||
          error.message?.includes("Could not find the table")
        ) {
          setModifiers([])
          return
        }
        throw error
      }

      if (data) {
        setModifiers(
          data.map((m) => ({
            id: m.id,
            name: m.name,
            price: m.price.toString(),
          }))
        )
      }
    } catch (err: any) {
      // Handle different error types
      const errorInfo = {
        message: err?.message || (typeof err === 'string' ? err : 'Unknown error'),
        code: err?.code,
        details: err?.details,
        hint: err?.hint,
        name: err?.name,
        stack: err?.stack,
      }
      
      // Only log if it's not a "table doesn't exist" or "schema cache" error (which is expected)
      if (
        err?.code !== "42P01" && 
        err?.code !== "42501" && 
        !err?.message?.includes("does not exist") &&
        !err?.message?.includes("schema cache") &&
        !err?.message?.includes("Could not find the table")
      ) {
        console.error("Error loading modifiers:", errorInfo)
      }
      
      // Don't throw - just log and continue with empty modifiers
      setModifiers([])
    }
  }, [productId])

  useEffect(() => {
    if (productId) {
      loadVariants()
      loadModifiers()
    } else {
      setVariants([])
      setModifiers([])
      setHasVariants(false)
    }
  }, [productId, loadVariants, loadModifiers])

  const addVariant = () => {
    setVariants([
      ...variants,
      {
        variant_name: "",
        sku: "",
        price: "",
        cost_price: "",
        stock: "0",
        barcode: "",
      },
    ])
    setHasVariants(true)
  }

  const removeVariant = (index: number) => {
    const newVariants = variants.filter((_, i) => i !== index)
    setVariants(newVariants)
    if (newVariants.length === 0) {
      setHasVariants(false)
    }
    if (onVariantsChange) {
      onVariantsChange(newVariants)
    }
  }

  const updateVariant = (index: number, field: keyof Variant, value: string) => {
    const newVariants = [...variants]
    newVariants[index] = { ...newVariants[index], [field]: value }
    setVariants(newVariants)
    if (onVariantsChange) {
      onVariantsChange(newVariants)
    }
  }

  const addModifier = () => {
    const newModifiers = [
      ...modifiers,
      {
        name: "",
        price: "",
      },
    ]
    setModifiers(newModifiers)
    if (onModifiersChange) {
      onModifiersChange(newModifiers)
    }
  }

  const removeModifier = (index: number) => {
    const newModifiers = modifiers.filter((_, i) => i !== index)
    setModifiers(newModifiers)
    if (onModifiersChange) {
      onModifiersChange(newModifiers)
    }
  }

  const updateModifier = (index: number, field: keyof ProductModifier, value: string) => {
    const newModifiers = [...modifiers]
    newModifiers[index] = { ...newModifiers[index], [field]: value }
    setModifiers(newModifiers)
    if (onModifiersChange) {
      onModifiersChange(newModifiers)
    }
  }

  const handleToggleVariants = (enabled: boolean) => {
    setHasVariants(enabled)
    if (!enabled) {
      setVariants([])
      if (onVariantsChange) {
        onVariantsChange([])
      }
    } else if (variants.length === 0) {
      addVariant()
    }
  }

  return (
    <div className="space-y-6">
      {/* Pricing & COGS Explanation for Variants */}
      {variants.length > 0 && (
        <div className="space-y-3">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-2">
              💡 Pricing for Variants
            </h4>
            <div className="text-xs text-blue-800 dark:text-blue-300 space-y-1">
              <p><strong>How pricing works:</strong></p>
              <ul className="list-disc list-inside ml-2 space-y-0.5">
                <li><strong>Parent Product Price</strong> = Base/default price for all variants</li>
                <li><strong>Variant Price Override</strong> = Optional. If set, this variant uses its own price instead of the parent price</li>
                <li>If a variant's "Price Override" is empty, it automatically uses the parent product's base price</li>
              </ul>
              <p className="mt-2"><strong>Example:</strong> Parent price = GHS 50.00. "Large" variant has price override = GHS 55.00. "Small" variant has no override → uses GHS 50.00.</p>
            </div>
          </div>
          
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-2">
              💡 COGS (Cost of Goods Sold) for Variants
            </h4>
            <div className="text-xs text-amber-800 dark:text-amber-300 space-y-1">
              <p><strong>How it works:</strong></p>
              <ul className="list-disc list-inside ml-2 space-y-0.5">
                <li>Each variant must have its own <strong>Cost Price</strong> (what you paid to acquire/manufacture that specific variant)</li>
                <li>When a sale is made, the system uses the <strong>variant's cost price</strong> (not the parent product's cost price)</li>
                <li>COGS = Variant Cost Price × Quantity Sold</li>
                <li>This ensures accurate profit calculations for each variant</li>
              </ul>
              <p className="mt-2"><strong>Example:</strong> If "T-Shirt - Large" costs you GHS 15.00 to make, enter 15.00 as the Cost Price for that variant.</p>
            </div>
          </div>
        </div>
      )}
      
      {/* Variants Section */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="hasVariants"
              checked={hasVariants}
              onChange={(e) => handleToggleVariants(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded"
            />
            <label htmlFor="hasVariants" className="font-semibold text-gray-800 dark:text-white">
              This product has variants
            </label>
          </div>
          {hasVariants && (
            <button
              onClick={addVariant}
              className="bg-blue-600 dark:bg-blue-700 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 dark:hover:bg-blue-600"
            >
              + Add Variant
            </button>
          )}
        </div>

        {hasVariants && (
          <div className="space-y-3">
            {variants.map((variant, index) => (
              <div
                key={index}
                className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-4"
              >
                <div className="flex justify-between items-start mb-3">
                  <h4 className="font-medium dark:text-white">Variant {index + 1}</h4>
                  <button
                    onClick={() => removeVariant(index)}
                    className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 text-sm"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                      Variant Name *
                    </label>
                    <input
                      type="text"
                      value={variant.variant_name}
                      onChange={(e) => updateVariant(index, "variant_name", e.target.value)}
                      placeholder="e.g., Large / Blue / 500mg"
                      className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm dark:bg-gray-700 dark:text-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">SKU *</label>
                    <input
                      type="text"
                      value={variant.sku}
                      onChange={(e) => updateVariant(index, "sku", e.target.value)}
                      placeholder="Unique SKU"
                      className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm dark:bg-gray-700 dark:text-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                      Barcode <span className="font-normal text-gray-500">(optional, unique per business)</span>
                    </label>
                    <RetailBarcodeFieldWithCamera
                      value={variant.barcode || ""}
                      onChange={(next) => updateVariant(index, "barcode", next)}
                      inputClassName="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm dark:bg-gray-700 dark:text-white"
                      placeholder="Scan or type — must not duplicate another variant barcode in your business"
                      scanButtonClassName="inline-flex shrink-0 items-center justify-center rounded border border-gray-300 bg-white px-2 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                      scanButtonLabel="Scan barcode"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                      Price Override (GHS)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={variant.price || ""}
                      onChange={(e) => updateVariant(index, "price", e.target.value)}
                      placeholder="Leave empty to use parent price"
                      className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm dark:bg-gray-700 dark:text-white"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Optional. If empty, uses the parent product's base price.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                      Cost Price (GHS) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={variant.cost_price || ""}
                      onChange={(e) => updateVariant(index, "cost_price", e.target.value)}
                      placeholder="0.00"
                      className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm dark:bg-gray-700 dark:text-white"
                      required
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Required for COGS calculation. What you paid for this variant.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Stock</label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={variant.stock}
                      onChange={(e) => updateVariant(index, "stock", e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modifiers Section */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800 dark:text-white">Modifiers (Add-ons)</h3>
          <button
            onClick={addModifier}
            className="bg-purple-600 dark:bg-purple-700 text-white px-3 py-1 rounded text-sm hover:bg-purple-700 dark:hover:bg-purple-600"
          >
            + Add Modifier
          </button>
        </div>

        {modifiers.length > 0 && (
          <div className="space-y-3">
            {modifiers.map((modifier, index) => (
              <div
                key={index}
                className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-3 flex items-center gap-3"
              >
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Name *</label>
                    <input
                      type="text"
                      value={modifier.name}
                      onChange={(e) => updateModifier(index, "name", e.target.value)}
                      placeholder="e.g., Warranty, Gift Box"
                      className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm dark:bg-gray-700 dark:text-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Price *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={modifier.price}
                      onChange={(e) => updateModifier(index, "price", e.target.value)}
                      placeholder="0.00"
                      className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm dark:bg-gray-700 dark:text-white"
                      required
                    />
                  </div>
                </div>
                <button
                  onClick={() => removeModifier(index)}
                  className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 text-sm mt-5"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {modifiers.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Add optional extras like warranty, gift box, batteries, etc.
          </p>
        )}
      </div>
    </div>
  )
}

