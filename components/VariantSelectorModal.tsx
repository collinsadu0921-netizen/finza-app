"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { getActiveStoreId } from "@/lib/storeSession"
import { useToast } from "@/components/ui/ToastProvider"
import { formatMoney } from "@/lib/money"

export type Variant = {
  id: string
  variant_name: string
  price: number | null
  stock_quantity: number
  stock: number
  sku: string | null
}

export type Modifier = {
  id: string
  name: string
  price: number
}

type VariantSelectorModalProps = {
  productId: string
  productName: string
  productPrice: number
  /** Business home currency; defaults to GHS for symbol formatting */
  currencyCode?: string | null
  onSelect: (variantId: string | null, variantName: string, variantPrice: number, modifiers: Modifier[]) => void
  onClose: () => void
  /**
   * When provided, skip Supabase and render from this catalog (Retail POS offline).
   * Modifiers are omitted offline unless included here.
   */
  localCatalog?: { variants: Variant[]; modifiers: Modifier[] }
}

export default function VariantSelectorModal({
  productId,
  productName,
  productPrice,
  currencyCode = null,
  onSelect,
  onClose,
  localCatalog,
}: VariantSelectorModalProps) {
  const toast = useToast()
  const homeCode = currencyCode ?? "GHS"
  const [variants, setVariants] = useState<Variant[]>([])
  const [modifiers, setModifiers] = useState<Modifier[]>([])
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null)
  const [selectedModifiers, setSelectedModifiers] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (localCatalog) {
      setVariants(localCatalog.variants)
      setModifiers(localCatalog.modifiers)
      setLoading(false)
      return
    }
    void loadVariantsAndModifiers()
  }, [productId, localCatalog])

  const loadVariantsAndModifiers = async () => {
    try {
      const [variantsResult, modifiersResult] = await Promise.all([
        supabase
          .from("products_variants")
          .select("id, variant_name, price, sku, barcode")
          .eq("product_id", productId)
          .order("variant_name", { ascending: true }),
        supabase
          .from("product_modifiers")
          .select("*")
          .eq("product_id", productId)
          .order("name", { ascending: true }),
      ])

      if (variantsResult.data && variantsResult.data.length > 0) {
        // Load variant stock from products_stock table
        const activeStoreId = getActiveStoreId()
        const variantIds = variantsResult.data.map((v: any) => v.id)
        
        let variantStockMap: Record<string, number> = {}
        
        if (activeStoreId && activeStoreId !== 'all') {
          const { data: stockData } = await supabase
            .from("products_stock")
            .select("variant_id, stock, stock_quantity")
            .eq("store_id", activeStoreId)
            .in("variant_id", variantIds)
            .not("variant_id", "is", null)

          if (stockData) {
            stockData.forEach((s: any) => {
              const stock = Math.floor(
                s.stock_quantity !== null && s.stock_quantity !== undefined
                  ? Number(s.stock_quantity)
                  : s.stock !== null && s.stock !== undefined
                  ? Number(s.stock)
                  : 0
              )
              variantStockMap[s.variant_id] = stock
            })
          }
        }

        // Combine variant data with stock from products_stock
        const variantsWithStock = variantsResult.data.map((v: any) => ({
          id: v.id,
          variant_name: v.variant_name,
          price: v.price ? Number(v.price) : null,
          stock_quantity: variantStockMap[v.id] !== undefined ? variantStockMap[v.id] : 0,
          stock: variantStockMap[v.id] !== undefined ? variantStockMap[v.id] : 0,
          sku: v.sku || null,
          barcode: v.barcode || null,
        }))

        setVariants(variantsWithStock)
      } else {
        setVariants([])
      }

      if (modifiersResult.data) {
        setModifiers(modifiersResult.data)
      }
    } catch (err) {
      console.error("Error loading variants/modifiers:", err)
    } finally {
      setLoading(false)
    }
  }

  const handleVariantSelect = (variantId: string) => {
    setSelectedVariant(variantId)
  }

  const toggleModifier = (modifierId: string) => {
    const newSet = new Set(selectedModifiers)
    if (newSet.has(modifierId)) {
      newSet.delete(modifierId)
    } else {
      newSet.add(modifierId)
    }
    setSelectedModifiers(newSet)
  }

  const handleConfirm = () => {
    if (variants.length > 0 && !selectedVariant) {
      toast.showToast("Please select a variant", "warning")
      return
    }

    const variant = variants.find((v) => v.id === selectedVariant)
    const variantName = variant ? variant.variant_name : productName
    const variantPrice = variant && variant.price !== null ? variant.price : productPrice

    const selectedModifierObjects = modifiers.filter((m) => selectedModifiers.has(m.id))

    onSelect(selectedVariant, variantName, variantPrice, selectedModifierObjects)
    onClose()
  }

  const getSelectedPrice = () => {
    const variant = variants.find((v) => v.id === selectedVariant)
    const basePrice = variant && variant.price !== null ? variant.price : productPrice
    const modifierTotal = modifiers
      .filter((m) => selectedModifiers.has(m.id))
      .reduce((sum, m) => sum + m.price, 0)
    return basePrice + modifierTotal
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6">
          <p className="dark:text-white">Loading...</p>
        </div>
      </div>
    )
  }

  // If no variants, just show modifiers or confirm immediately
  if (variants.length === 0) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
          <h2 className="text-xl font-bold mb-4 dark:text-white">{productName}</h2>

          {modifiers.length > 0 && (
            <div className="mb-4">
              <h3 className="font-semibold mb-2 dark:text-white">Add-ons (Optional)</h3>
              <div className="space-y-2">
                {modifiers.map((modifier) => (
                  <label
                    key={modifier.id}
                    className="flex items-center gap-2 p-2 border border-gray-200 dark:border-gray-700 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <input
                      type="checkbox"
                      checked={selectedModifiers.has(modifier.id)}
                      onChange={() => toggleModifier(modifier.id)}
                      className="w-4 h-4"
                    />
                    <span className="flex-1 dark:text-white">{modifier.name}</span>
                    <span className="text-gray-600 dark:text-gray-400">+{formatMoney(modifier.price, homeCode)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-between items-center mb-4">
            <span className="font-semibold dark:text-white">Total:</span>
            <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
              {formatMoney(getSelectedPrice(), homeCode)}
            </span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 bg-gray-300 dark:bg-gray-700 text-gray-800 dark:text-white px-4 py-2 rounded hover:bg-gray-400 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 bg-blue-600 dark:bg-blue-700 text-white px-4 py-2 rounded hover:bg-blue-700 dark:hover:bg-blue-600"
            >
              Add to Cart
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4 dark:text-white">{productName}</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Select a variant:</p>

        <div className="space-y-2 mb-4">
          {variants.map((variant) => {
            const stock = variant.stock_quantity || variant.stock || 0
            const isOutOfStock = stock <= 0
            const isSelected = selectedVariant === variant.id
            const price = variant.price !== null ? variant.price : productPrice

            return (
              <button
                key={variant.id}
                onClick={() => !isOutOfStock && handleVariantSelect(variant.id)}
                disabled={isOutOfStock}
                className={`w-full text-left p-3 border rounded ${
                  isSelected
                    ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-500"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                } ${isOutOfStock ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-medium dark:text-white">{variant.variant_name}</div>
                    {variant.sku && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">SKU: {variant.sku}</div>
                    )}
                    {isOutOfStock && (
                      <div className="text-xs text-red-600 dark:text-red-400 mt-1">Out of Stock</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-semibold dark:text-white">{formatMoney(price, homeCode)}</div>
                    {!isOutOfStock && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">Stock: {stock}</div>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {modifiers.length > 0 && selectedVariant && (
          <div className="mb-4">
            <h3 className="font-semibold mb-2 dark:text-white">Add-ons (Optional)</h3>
            <div className="space-y-2">
              {modifiers.map((modifier) => (
                <label
                  key={modifier.id}
                  className="flex items-center gap-2 p-2 border border-gray-200 dark:border-gray-700 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <input
                    type="checkbox"
                    checked={selectedModifiers.has(modifier.id)}
                    onChange={() => toggleModifier(modifier.id)}
                    className="w-4 h-4"
                  />
                  <span className="flex-1 dark:text-white">{modifier.name}</span>
                  <span className="text-gray-600 dark:text-gray-400">+{formatMoney(modifier.price, homeCode)}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {selectedVariant && (
          <div className="flex justify-between items-center mb-4">
            <span className="font-semibold dark:text-white">Total:</span>
            <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
              {formatMoney(getSelectedPrice(), homeCode)}
            </span>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 bg-gray-300 dark:bg-gray-700 text-gray-800 dark:text-white px-4 py-2 rounded hover:bg-gray-400 dark:hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedVariant}
            className="flex-1 bg-blue-600 dark:bg-blue-700 text-white px-4 py-2 rounded hover:bg-blue-700 dark:hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed"
          >
            Add to Cart
          </button>
        </div>
      </div>
    </div>
  )
}







