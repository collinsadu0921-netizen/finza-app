"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { getActiveStoreId } from "@/lib/storeSession"
import StockAdjustmentModal from "@/components/StockAdjustmentModal"
import Toast from "@/components/Toast"
import ErrorAlert from "@/components/ErrorAlert"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { formatMoney } from "@/lib/money"
import { NativeSelect } from "@/components/ui/NativeSelect"

type Product = {
  id: string
  name: string
  price: number
  category_id: string | null
  stock?: number
  low_stock_threshold?: number
  hasVariants?: boolean
  tax_category?: string | null
}

type Category = {
  id: string
  name: string
}

export default function ProductsPage() {
  const router = useRouter()
  const { currencyCode, format } = useBusinessCurrency()
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [businessId, setBusinessId] = useState("")
  const [businessIndustry, setBusinessIndustry] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("")
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [selectedVariant, setSelectedVariant] = useState<{
    id: string
    name: string
    productId: string
  } | null>(null)
  const [userId, setUserId] = useState<string>("")
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set())
  const [variantsData, setVariantsData] = useState<Record<string, Array<{
    id: string
    variant_name: string
    price: number | null
    stock: number
    sku: string | null
    barcode: string | null
  }>>>({})
  const [showCreateVariantModal, setShowCreateVariantModal] = useState(false)
  const [createVariantProductId, setCreateVariantProductId] = useState<string | null>(null)
  const [showEditVariantModal, setShowEditVariantModal] = useState(false)
  const [editingVariant, setEditingVariant] = useState<{
    productId: string
    variantId: string
    variantName: string
    price: number | null
    sku: string | null
    barcode: string | null
  } | null>(null)
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null)
  const [error, setError] = useState<string>("")
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{ productId: string; productName: string } | null>(null)

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    try {
      setError("")
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setLoading(false)
        return
      }

      setUserId(user.id)

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setLoading(false)
        return
      }

      setBusinessId(business.id)
      setBusinessIndustry(business.industry || null)
      
      // INVARIANT: Service workspace uses products_services, Retail uses products
      const isService = business.industry === "service"
      
      let prods: any[] | null = null
      let prodsError: any = null
      
      if (isService) {
        // Service workspace: Load from products_services table
        const res = await supabase
          .from("products_services")
          .select("id, name, unit_price, category_id, description, tax_applicable")
          .eq("business_id", business.id)
          .eq("type", "service")
          .is("deleted_at", null)
          .order("name", { ascending: true })
        prods = res.data ?? null
        prodsError = res.error
      } else {
        // Retail workspace: Load from products table
        const res = await supabase
          .from("products")
          .select("id, name, price, category_id, low_stock_threshold, tax_category")
          .eq("business_id", business.id)
          .order("name", { ascending: true })
        prods = res.data ?? null
        prodsError = res.error
        if (prodsError && (String(prodsError.message || "").includes("tax_category") || String(prodsError.message || "").includes("schema cache"))) {
          const fallback = await supabase
            .from("products")
            .select("id, name, price, category_id, low_stock_threshold")
            .eq("business_id", business.id)
            .order("name", { ascending: true })
          prods = fallback.data ?? null
          prodsError = fallback.error
        }
      }
      
      if (prodsError) {
        setError(prodsError.message || "Failed to load products")
        setLoading(false)
        return
      }

      // Load categories
      const { data: cats } = await supabase
        .from("categories")
        .select("id, name")
        .eq("business_id", business.id)
        .order("name", { ascending: true })

      setCategories(cats || [])

      // Retail-only: Check which products have variants
      const productsWithVariants = new Set<string>()
      if (!isService && prods && prods.length > 0) {
        try {
          const { data: variantsData } = await supabase
            .from("products_variants")
            .select("product_id")
            .in("product_id", prods.map((p: any) => p.id))

          if (variantsData) {
            variantsData.forEach((v: any) => {
              productsWithVariants.add(v.product_id)
            })
          }
        } catch (err: any) {
          // If table doesn't exist or permission denied, continue without variants check
          if (
            err?.code !== "42P01" &&
            err?.code !== "42501" &&
            !err?.message?.includes("does not exist") &&
            !err?.message?.includes("schema cache")
          ) {
            console.error("Error checking variants:", err)
          }
        }
      }

      // Retail-only: Load stock from products_stock for active store only
      const activeStoreId = isService ? null : getActiveStoreId()
      const stockByProductId: Record<string, number> = {}
      
      if (!isService && activeStoreId && activeStoreId !== 'all') {
        const { data: stockRows } = await supabase
          .from("products_stock")
          .select("product_id, stock")
          .eq("store_id", activeStoreId)
          .is("variant_id", null)
          .in("product_id", (prods || []).map((p: any) => p.id))

        if (stockRows) {
          for (const row of stockRows) {
            const stock = Number(row.stock)
            if (!isNaN(stock)) {
              stockByProductId[row.product_id] = stock
            }
          }
        }
      }

      // Format products (service vs retail)
      const formattedProducts = (prods || []).map((p) => {
        if (isService) {
          // Service items: simple structure
          return {
            id: p.id,
            name: p.name,
            price: Number(p.unit_price || 0),
            category_id: p.category_id,
            description: p.description,
            tax_applicable: p.tax_applicable ?? true,
            hasVariants: false,
          }
        } else {
          // Retail products: with variants and stock
          const hasVariants = productsWithVariants.has(p.id)
          const stockValue = (activeStoreId && activeStoreId !== 'all' && stockByProductId[p.id] !== undefined)
            ? stockByProductId[p.id]
            : undefined
          
          return {
            id: p.id,
            name: p.name,
            price: Number(p.price || 0),
            category_id: p.category_id,
            stock: stockValue,
            low_stock_threshold: p.low_stock_threshold ? Number(p.low_stock_threshold) : undefined,
            hasVariants: hasVariants,
            tax_category: p.tax_category ?? undefined,
          }
        }
      })

      setProducts(formattedProducts)
      setLoading(false)
    } catch (err: any) {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      
        <div className="p-6">
          <p>Loading...</p>
        </div>
      
    )
  }

  const isService = businessIndustry === "service"
  const activeStoreId = isService ? null : getActiveStoreId()
  const hasStore = !isService && activeStoreId && activeStoreId !== 'all'

  const handleDelete = (productId: string, productName: string) => {
    setShowDeleteConfirm({ productId, productName })
  }

  const confirmDelete = async () => {
    if (!showDeleteConfirm) return

    try {
      const tableName = isService ? "products_services" : "products"
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq("id", showDeleteConfirm.productId)

      if (error) {
        setToast({ message: `Error deleting ${isService ? "service" : "product"}: ${error.message}`, type: "error" })
        setShowDeleteConfirm(null)
        return
      }

      // Reload products after delete
      load()
      setToast({ message: `${isService ? "Service" : "Product"} "${showDeleteConfirm.productName}" deleted successfully`, type: "success" })
      setShowDeleteConfirm(null)
    } catch (err: any) {
      setToast({ message: `Error deleting ${isService ? "service" : "product"}: ${err.message}`, type: "error" })
      setShowDeleteConfirm(null)
    }
  }

  const handleAdjustStock = (product: Product, variantId?: string, variantName?: string) => {
    setSelectedProduct(product)
    if (variantId && variantName) {
      setSelectedVariant({ id: variantId, name: variantName, productId: product.id })
    } else {
      setSelectedVariant(null)
    }
    setShowAdjustmentModal(true)
  }

  const handleEditVariant = (productId: string, variantId: string, variantName: string, currentPrice: number | null) => {
    // Get current variant data
    const variant = variantsData[productId]?.find((v) => v.id === variantId)
    if (!variant) return

    setEditingVariant({
      productId,
      variantId,
      variantName,
      price: currentPrice,
      sku: variant.sku,
      barcode: variant.barcode,
    })
    setShowEditVariantModal(true)
  }

  const handleEditVariantSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!editingVariant) return

    const formData = new FormData(e.currentTarget)
    const newName = formData.get("variant_name")?.toString()?.trim() || ""
    const newSku = formData.get("sku")?.toString()?.trim() || ""
    const newBarcode = formData.get("barcode")?.toString()?.trim() || ""
    const priceStr = formData.get("price")?.toString() || ""

    if (!newName || !newName.trim()) {
      setToast({ message: "Variant name is required", type: "error" })
      return
    }

    if (!newSku || !newSku.trim()) {
      setToast({ message: "SKU is required", type: "error" })
      return
    }

    let newPrice: number | null = editingVariant.price
    if (priceStr !== null && priceStr.trim() !== "") {
      const parsed = parseFloat(priceStr)
      if (!isNaN(parsed) && parsed >= 0) {
        newPrice = parsed
      }
    }

    if (newName.trim() === editingVariant.variantName && 
        newPrice === editingVariant.price &&
        newSku === editingVariant.sku &&
        newBarcode === editingVariant.barcode) {
      setShowEditVariantModal(false)
      setEditingVariant(null)
      return // No changes
    }

    try {
      const updateData: any = {}
      if (newName.trim() !== editingVariant.variantName) {
        updateData.variant_name = newName.trim()
      }
      if (newPrice !== editingVariant.price) {
        updateData.price = newPrice
      }
      if (newSku !== editingVariant.sku) {
        updateData.sku = newSku || null
      }
      if (newBarcode !== editingVariant.barcode) {
        updateData.barcode = newBarcode || null
      }

      if (Object.keys(updateData).length === 0) {
        setShowEditVariantModal(false)
        setEditingVariant(null)
        return
      }

      const { error } = await supabase
        .from("products_variants")
        .update(updateData)
        .eq("id", editingVariant.variantId)
        .eq("product_id", editingVariant.productId)

      if (error) {
        setToast({ message: `Error updating variant: ${error.message}`, type: "error" })
        return
      }

      // Reload variants for this product
      await loadVariantsForProduct(editingVariant.productId)
      setToast({ message: "Variant updated successfully", type: "success" })
      setShowEditVariantModal(false)
      setEditingVariant(null)
    } catch (err: any) {
      setToast({ message: `Error updating variant: ${err.message}`, type: "error" })
    }
  }

  const handleCreateVariant = (productId: string) => {
    if (isService) return // Variants not supported in service workspace
    setCreateVariantProductId(productId)
    setShowCreateVariantModal(true)
  }

  const handleCreateVariantSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const variantName = formData.get("variant_name")?.toString().trim()
    const sku = formData.get("sku")?.toString().trim()
    const barcode = formData.get("barcode")?.toString().trim()
    const variantPrice = formData.get("price")?.toString()
    const initialStock = formData.get("stock")?.toString() || "0"

    if (!variantName) {
      setToast({ message: "Variant name is required", type: "error" })
      return
    }

    if (!sku) {
      setToast({ message: "SKU is required", type: "error" })
      return
    }

    if (!createVariantProductId) {
      setToast({ message: "Product ID is missing", type: "error" })
      return
    }

    try {
      const activeStoreId = getActiveStoreId()
      if (!activeStoreId || activeStoreId === 'all') {
        setToast({ message: "Please select a store before creating a variant", type: "error" })
        return
      }

      // Create variant
      const { data: newVariant, error: variantError } = await supabase
        .from("products_variants")
        .insert({
          product_id: createVariantProductId,
          variant_name: variantName,
          sku: sku || null,
          barcode: barcode || null,
          price: variantPrice ? parseFloat(variantPrice) : null,
        })
        .select()
        .single()

      if (variantError) {
        setToast({ message: `Error creating variant: ${variantError.message}`, type: "error" })
        return
      }

      // Create products_stock row for variant
      const stockQty = parseInt(initialStock) || 0
      if (stockQty > 0) {
        const { error: stockError } = await supabase
          .from("products_stock")
          .insert({
            product_id: createVariantProductId,
            variant_id: newVariant.id,
            store_id: activeStoreId,
            stock: stockQty,
            stock_quantity: stockQty,
          })

        if (stockError) {
          console.error("Error creating variant stock:", stockError)
          // Don't fail - stock can be adjusted later
        }
      }

      // Reload variants for this product
      await loadVariantsForProduct(createVariantProductId)
      
      // Reload products to update hasVariants flag
      await load()
      
      // Close modal and reset
      setShowCreateVariantModal(false)
      setCreateVariantProductId(null)
      setToast({ message: "Variant created successfully", type: "success" })
    } catch (err: any) {
      setToast({ message: `Error creating variant: ${err.message}`, type: "error" })
    }
  }

  const handleEdit = (productId: string) => {
    router.push(`/products/${productId}/edit`)
  }

  const toggleVariants = async (productId: string) => {
    if (isService) return // Variants not supported in service workspace
    const isExpanded = expandedProducts.has(productId)
    
    if (isExpanded) {
      // Collapse: remove from expanded set
      const newExpanded = new Set(expandedProducts)
      newExpanded.delete(productId)
      setExpandedProducts(newExpanded)
    } else {
      // Expand: add to expanded set and load variants
      const newExpanded = new Set(expandedProducts)
      newExpanded.add(productId)
      setExpandedProducts(newExpanded)
      
      // Load variants for this product
      await loadVariantsForProduct(productId)
    }
  }

  const loadVariantsForProduct = async (productId: string) => {
    try {
      const activeStoreId = getActiveStoreId()
      if (!activeStoreId || activeStoreId === 'all') {
        return
      }

      // Load variants
      const { data: variants, error: variantsError } = await supabase
        .from("products_variants")
        .select("id, variant_name, price, sku, barcode")
        .eq("product_id", productId)
        .order("variant_name", { ascending: true })

      if (variantsError) {
        // If table doesn't exist or permission denied, continue silently
        if (
          variantsError.code !== "42P01" &&
          variantsError.code !== "42501" &&
          !variantsError.message?.includes("does not exist") &&
          !variantsError.message?.includes("schema cache")
        ) {
          console.error("Error loading variants:", variantsError)
        }
        return
      }

      if (!variants || variants.length === 0) {
        return
      }

      const variantIds = variants.map((v: any) => v.id)

      // Load variant stock from products_stock
      const { data: stockRows, error: stockError } = await supabase
        .from("products_stock")
        .select("variant_id, stock")
        .eq("store_id", activeStoreId)
        .in("variant_id", variantIds)
        .not("variant_id", "is", null)

      if (stockError) {
        console.error("Error loading variant stock:", stockError)
        return
      }

      // Create stock map: variant_id -> stock
      const stockMap: Record<string, number> = {}
      if (stockRows) {
        for (const row of stockRows) {
          const stock = Number(row.stock)
          if (!isNaN(stock)) {
            stockMap[row.variant_id] = stock
          }
        }
      }

      // Combine variants with stock
      const variantsWithStock = variants.map((v: any) => ({
        id: v.id,
        variant_name: v.variant_name,
        price: v.price ? Number(v.price) : null,
        stock: stockMap[v.id] !== undefined ? stockMap[v.id] : 0,
        sku: v.sku || null,
        barcode: v.barcode || null,
      }))

      // Update variants data
      setVariantsData((prev) => ({
        ...prev,
        [productId]: variantsWithStock,
      }))
    } catch (err: any) {
      console.error("Error loading variants for product:", err)
    }
  }

  return (
    
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Products & Services</h1>
          <div className="flex gap-2">
            <button
              onClick={() => router.push(isService ? "/products/create-service" : "/products/new")}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium"
            >
              {isService ? "Create Service" : "Create Product"}
            </button>
            <button
              onClick={() => router.push("/dashboard")}
              className="bg-gray-300 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-400"
            >
              Dashboard
            </button>
          </div>
        </div>

        {!isService && !hasStore && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded mb-4">
            Please select a store
          </div>
        )}

        {error && (
          <ErrorAlert message={error} onDismiss={() => setError("")} />
        )}

        {/* Search and filters */}
        <div className="mb-4 flex flex-wrap gap-3">
          <input
            type="text"
            placeholder={isService ? "Search services by name..." : "Search products by name..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 min-w-[200px] border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <NativeSelect
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            size="lg"
            wrapperClassName="w-auto shrink-0 min-w-[10rem]"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </NativeSelect>
        </div>

        {/* Filter products by search and category */}
        {(() => {
          let list = products
          if (searchQuery.trim()) {
            list = list.filter((p) =>
              p.name.toLowerCase().includes(searchQuery.toLowerCase())
            )
          }
          if (categoryFilter) {
            list = list.filter((p) => p.category_id === categoryFilter)
          }
          const filteredProducts = list

          if (filteredProducts.length === 0) {
            return (
              <div className="border border-gray-200 rounded-lg p-8 text-center bg-gray-50">
                <p className="text-gray-600 text-lg mb-2">
                  {searchQuery 
                    ? `No ${isService ? "services" : "products"} found matching "${searchQuery}"` 
                    : `No ${isService ? "services" : "products"} yet`}
                </p>
                {!searchQuery && (
                  <button
                    onClick={() => router.push(isService ? "/products/create-service" : "/products/new")}
                    className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 font-medium"
                  >
                    Create Your First {isService ? "Service" : "Product"}
                  </button>
                )}
              </div>
            )
          }

          return (
            <div className="space-y-3">
              {filteredProducts.map((product) => {
                const category = categories.find((c) => c.id === product.category_id)
                const stockDisplay = !isService && hasStore && product.stock !== undefined ? product.stock : (!isService && hasStore ? 0 : undefined)
                const isLowStock = !isService && !product.hasVariants && hasStore && 
                  product.stock !== undefined && 
                  product.low_stock_threshold !== undefined && 
                  product.low_stock_threshold > 0 && 
                  product.stock <= product.low_stock_threshold

                return (
                  <div
                    key={product.id}
                    className={`border rounded-lg hover:bg-gray-50 transition-colors ${
                      isLowStock ? 'border-yellow-300 bg-yellow-50' : 'border-gray-200'
                    }`}
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-medium text-lg text-gray-900">{product.name}</h3>
                            {category && (
                              <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded whitespace-nowrap">
                                {category.name}
                              </span>
                            )}
                            {!isService && product.hasVariants && (
                              <span className="px-2 py-1 bg-purple-100 text-purple-800 text-xs font-semibold rounded whitespace-nowrap">
                                Has variants
                              </span>
                            )}
                            {!isService && !product.hasVariants && (
                              <button
                                onClick={() => handleCreateVariant(product.id)}
                                className="px-2 py-1 bg-purple-100 text-purple-800 text-xs font-semibold rounded whitespace-nowrap hover:bg-purple-200"
                                title="Add variants to this product"
                              >
                                + Add Variants
                              </button>
                            )}
                            {isService && (product as any).tax_applicable !== undefined && (
                              <span className={`px-2 py-1 text-xs font-semibold rounded whitespace-nowrap ${
                                (product as any).tax_applicable 
                                  ? "bg-green-100 text-green-800" 
                                  : "bg-gray-100 text-gray-800"
                              }`}>
                                {(product as any).tax_applicable ? "Taxable" : "Non-taxable"}
                              </span>
                            )}
                            {isLowStock && (
                              <span className="px-2 py-1 bg-yellow-200 text-yellow-800 text-xs font-semibold rounded whitespace-nowrap">
                                Low Stock
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-sm text-gray-600">
                            <span className="font-semibold text-gray-900">
                              {format(product.price)}
                            </span>
                            {isService && (product as any).description && (
                              <span className="text-gray-500 italic">
                                {(product as any).description}
                              </span>
                            )}
                            {!isService && hasStore && !product.hasVariants && (
                              <span className={isLowStock ? 'text-yellow-700 font-medium' : ''}>
                                Stock: {stockDisplay}
                                {product.low_stock_threshold && product.low_stock_threshold > 0 && (
                                  <span className="text-gray-500 ml-1">
                                    (Low: {product.low_stock_threshold})
                                  </span>
                                )}
                              </span>
                            )}
                            {!isService && hasStore && product.hasVariants && (
                              <span className="text-purple-600 font-medium">
                                Variants available
                              </span>
                            )}
                          </div>
                          {/* Variants toggle and list (retail only) */}
                          {!isService && product.hasVariants && (
                            <div className="mt-2">
                              <button
                                onClick={() => toggleVariants(product.id)}
                                className="text-sm text-purple-600 hover:text-purple-700 font-medium flex items-center gap-1"
                              >
                                {expandedProducts.has(product.id) ? (
                                  <>
                                    <span>▼</span>
                                    <span>Hide variants</span>
                                  </>
                                ) : (
                                  <>
                                    <span>▶</span>
                                    <span>View variants</span>
                                  </>
                                )}
                              </button>
                              {expandedProducts.has(product.id) && variantsData[product.id] && (
                                <div className="mt-2 ml-4 space-y-2 border-l-2 border-purple-200 pl-4">
                                  {variantsData[product.id].map((variant) => (
                                    <div key={variant.id} className="text-sm border-b border-gray-100 pb-2 last:border-b-0">
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-3 flex-1 flex-wrap">
                                          <span className="font-medium text-gray-900">
                                            {variant.variant_name}
                                          </span>
                                          {variant.sku && (
                                            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                                              SKU: {variant.sku}
                                            </span>
                                          )}
                                          {variant.barcode && (
                                            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                                              Barcode: {variant.barcode}
                                            </span>
                                          )}
                                          {variant.price !== null && (
                                            <span className="text-gray-600">
                                              {format(variant.price)}
                                            </span>
                                          )}
                                          {hasStore && (
                                            <span className="text-gray-600">
                                              Stock: {variant.stock}
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex gap-1 flex-shrink-0">
                                          {hasStore && (
                                            <button
                                              onClick={() => handleAdjustStock(product, variant.id, variant.variant_name)}
                                              className="bg-purple-600 text-white px-2 py-1 rounded text-xs hover:bg-purple-700 font-medium"
                                              title="Adjust Stock"
                                            >
                                              Stock
                                            </button>
                                          )}
                                          <button
                                            onClick={() => handleEditVariant(product.id, variant.id, variant.variant_name, variant.price)}
                                            className="bg-blue-600 text-white px-2 py-1 rounded text-xs hover:bg-blue-700 font-medium"
                                            title="Edit Variant"
                                          >
                                            Edit
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                  <div className="pt-2">
                                    <button
                                      onClick={() => handleCreateVariant(product.id)}
                                      className="text-xs text-purple-600 hover:text-purple-700 font-medium"
                                    >
                                      + Add Variant
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          {!isService && hasStore && (
                            <>
                              {!product.hasVariants ? (
                                <button
                                  onClick={() => handleAdjustStock(product)}
                                  className="bg-purple-600 text-white px-3 py-1.5 rounded text-sm hover:bg-purple-700 font-medium"
                                >
                                  Adjust Stock
                                </button>
                              ) : (
                                <button
                                  disabled
                                  className="bg-gray-300 text-gray-500 px-3 py-1.5 rounded text-sm cursor-not-allowed font-medium"
                                  title="Adjust stock for individual variants instead"
                                >
                                  Adjust Stock
                                </button>
                              )}
                            </>
                          )}
                          <button
                            onClick={() => handleEdit(product.id)}
                            className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 font-medium"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(product.id, product.name)}
                            className="bg-red-600 text-white px-3 py-1.5 rounded text-sm hover:bg-red-700 font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}

        {/* Stock Adjustment Modal (retail only) */}
        {!isService && selectedProduct && (
          <StockAdjustmentModal
            isOpen={showAdjustmentModal}
            onClose={() => {
              setShowAdjustmentModal(false)
              setSelectedProduct(null)
              setSelectedVariant(null)
            }}
            onSuccess={() => {
              load()
              if (selectedVariant) {
                loadVariantsForProduct(selectedVariant.productId)
              }
              setShowAdjustmentModal(false)
              setSelectedProduct(null)
              setSelectedVariant(null)
            }}
            product={{
              id: selectedProduct.id,
              name: selectedProduct.name,
              stock: selectedProduct.stock,
              stock_quantity: selectedProduct.stock,
            }}
            businessId={businessId}
            userId={userId}
            variantId={selectedVariant?.id || null}
            variantName={selectedVariant?.name}
          />
        )}

        {/* Create Variant Modal (retail only) */}
        {!isService && showCreateVariantModal && createVariantProductId && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <h2 className="text-xl font-bold mb-4">Create Variant</h2>
              <form onSubmit={handleCreateVariantSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Variant Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="variant_name"
                    required
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., Small, Red, 500ml"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    SKU <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="sku"
                    required
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Unique SKU code"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Barcode
                  </label>
                  <input
                    type="text"
                    name="barcode"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Optional barcode"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Price {currencyCode ? `(${currencyCode})` : ''}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name="price"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Initial Stock
                  </label>
                  <input
                    type="number"
                    min="0"
                    name="stock"
                    defaultValue="0"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium"
                  >
                    Create Variant
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateVariantModal(false)
                      setCreateVariantProductId(null)
                    }}
                    className="bg-gray-300 text-gray-800 px-6 py-2 rounded-lg hover:bg-gray-400 font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit Variant Modal (retail only) */}
        {!isService && showEditVariantModal && editingVariant && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <h2 className="text-xl font-bold mb-4">Edit Variant</h2>
              <form onSubmit={handleEditVariantSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Variant Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="variant_name"
                    required
                    defaultValue={editingVariant.variantName}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., Small, Red, 500ml"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    SKU <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="sku"
                    required
                    defaultValue={editingVariant.sku || ""}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Unique SKU code"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Barcode
                  </label>
                  <input
                    type="text"
                    name="barcode"
                    defaultValue={editingVariant.barcode || ""}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Optional barcode"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Price {currencyCode ? `(${currencyCode})` : ''}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name="price"
                    defaultValue={editingVariant.price || ""}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Optional"
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium"
                  >
                    Save Changes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditVariantModal(false)
                      setEditingVariant(null)
                    }}
                    className="bg-gray-300 text-gray-800 px-6 py-2 rounded-lg hover:bg-gray-400 font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <h2 className="text-xl font-bold mb-4">Confirm Delete</h2>
              <p className="text-gray-600 mb-6">
                Are you sure you want to delete "{showDeleteConfirm.productName}"? This action cannot be undone.
              </p>
              {isService && (
                <p className="text-sm text-yellow-600 mb-4">
                  Note: This service item will be removed from future invoices, but existing invoices will retain their line items.
                </p>
              )}
              <div className="flex gap-4">
                <button
                  onClick={confirmDelete}
                  className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-lg font-medium"
                >
                  Delete
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="bg-gray-300 text-gray-800 px-6 py-2 rounded-lg hover:bg-gray-400 font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Toast Notification */}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </div>
    
  )
}
