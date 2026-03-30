"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { getActiveStoreId } from "@/lib/storeSession"
import { formatMoney } from "@/lib/money"
import { getCurrencySymbol } from "@/lib/currency"

interface RetailOnboardingProductsProps {
  business: any
  businessId: string
  onComplete: () => void
}

const TAX_CATEGORIES = ["taxable", "zero_rated", "exempt"] as const
type TaxCategory = (typeof TAX_CATEGORIES)[number]

type Product = {
  id?: string
  name: string
  price: string
  barcode: string
  stock: string
  category_id: string
  tax_category: TaxCategory
}

export default function RetailOnboardingProducts({
  business,
  businessId,
  onComplete
}: RetailOnboardingProductsProps) {
  const homeCode = business?.default_currency || "GHS"
  const currencySymbol = getCurrencySymbol(homeCode)
  const [products, setProducts] = useState<Product[]>([])
  const [formData, setFormData] = useState<Omit<Product, "tax_category"> & { tax_category: TaxCategory | "" }>({
    name: "",
    price: "",
    barcode: "",
    stock: "0",
    category_id: "",
    tax_category: "",
  })
  const [categories, setCategories] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    loadCategories()
  }, [])

  const loadCategories = async () => {
    try {
      const { data, error } = await supabase
        .from("categories")
        .select("id, name")
        .eq("business_id", businessId)
        .order("name")

      if (error) throw error
      setCategories(data || [])
    } catch (err) {
      console.error("Error loading categories:", err)
    }
  }

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!formData.name.trim()) {
      setError("Product name is required")
      return
    }

    if (!formData.price || parseFloat(formData.price) <= 0) {
      setError("Valid price is required")
      return
    }

    if (!formData.tax_category || !TAX_CATEGORIES.includes(formData.tax_category as TaxCategory)) {
      setError("Tax category is required. Please select taxable, zero-rated, or exempt.")
      return
    }

    setAdding(true)

    try {
      const activeStoreId = getActiveStoreId()
      if (!activeStoreId) {
        throw new Error("Please create a store first")
      }

      // Create product
      const { data: newProduct, error: productError } = await supabase
        .from("products")
        .insert({
          business_id: businessId,
          name: formData.name.trim(),
          price: parseFloat(formData.price),
          barcode: formData.barcode.trim() || null,
          category_id: formData.category_id || null,
          track_stock: true,
          tax_category: formData.tax_category as TaxCategory,
        })
        .select()
        .single()

      if (productError) throw productError

      // Create products_stock row for active store
      const { error: stockError } = await supabase
        .from("products_stock")
        .insert({
          product_id: newProduct.id,
          store_id: activeStoreId,
          stock: parseInt(formData.stock) || 0,
          stock_quantity: parseInt(formData.stock) || 0,
        })

      if (stockError) throw stockError

      // Add to list
      setProducts([
        ...products,
        { ...formData, tax_category: formData.tax_category as TaxCategory, id: newProduct.id } as Product,
      ])

      // Reset form
      setFormData({
        name: "",
        price: "",
        barcode: "",
        stock: "0",
        category_id: "",
        tax_category: "",
      })
    } catch (err: any) {
      console.error("Error adding product:", err)
      setError(err.message || "Failed to add product")
    } finally {
      setAdding(false)
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
        Step 3: Add Products to Your Inventory
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        Add products to your inventory so you can start selling them at the POS terminal. You can add more products later or import via CSV.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Products List */}
      {products.length > 0 && (
        <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
            Added Products ({products.length})
          </h3>
          <ul className="space-y-1">
            {products.map((product, index) => (
              <li key={index} className="text-sm text-gray-600 dark:text-gray-300">
                • {product.name} - {formatMoney(parseFloat(product.price), homeCode)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Add Product Form */}
      <form onSubmit={handleAddProduct} className="space-y-4 mb-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Product Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              required
              placeholder="e.g., Coca Cola 500ml"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Price ({currencySymbol}) *
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              required
              placeholder="0.00"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Tax Category <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.tax_category}
              onChange={(e) => setFormData({ ...formData, tax_category: e.target.value as TaxCategory | "" })}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              required
            >
              <option value="">— Select —</option>
              <option value="taxable">Taxable</option>
              <option value="zero_rated">Zero-rated</option>
              <option value="exempt">Exempt</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Barcode/SKU
            </label>
            <input
              type="text"
              value={formData.barcode}
              onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              placeholder="Optional"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Initial Stock
            </label>
            <input
              type="number"
              min="0"
              value={formData.stock}
              onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              placeholder="0"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={adding}
          className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {adding ? "Adding..." : "Add Product"}
        </button>
      </form>

      <div className="flex gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={onComplete}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
        >
          Continue
        </button>
        <button
          onClick={onComplete}
          className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 px-6 py-3 rounded-lg font-medium"
        >
          Skip for Now
        </button>
      </div>
    </div>
  )
}



















