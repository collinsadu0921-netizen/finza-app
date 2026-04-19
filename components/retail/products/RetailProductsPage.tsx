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
import { cn } from "@/lib/utils"
import { retailPaths } from "@/lib/retail/routes"
import {
  RetailBackofficeAlert,
  RetailBackofficeBadge,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeEmpty,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
  retailFieldClass,
  RetailMenuSelect,
} from "@/components/retail/RetailBackofficeUi"
import RetailBarcodeFieldWithCamera from "@/components/retail/RetailBarcodeFieldWithCamera"

type Product = {
  id: string
  name: string
  price: number
  category_id: string | null
  barcode?: string | null
  stock?: number
  low_stock_threshold?: number
  hasVariants?: boolean
  tax_category?: string | null
}

type Category = {
  id: string
  name: string
}

export default function RetailProductsPage() {
  const router = useRouter()
  const { currencyCode, format } = useBusinessCurrency()
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [businessId, setBusinessId] = useState("")
  const [workspaceMismatch, setWorkspaceMismatch] = useState(false)
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
  const [createVariantBarcode, setCreateVariantBarcode] = useState("")
  const [editVariantBarcode, setEditVariantBarcode] = useState("")

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

      if (business.industry === "service") {
        setWorkspaceMismatch(true)
        setLoading(false)
        return
      }
      setWorkspaceMismatch(false)

      let prods: any[] | null = null
      let prodsError: any = null

      const res = await supabase
        .from("products")
        .select("id, name, price, category_id, barcode, low_stock_threshold, tax_category")
        .eq("business_id", business.id)
        .order("name", { ascending: true })
      prods = res.data ?? null
      prodsError = res.error
      if (prodsError && (String(prodsError.message || "").includes("tax_category") || String(prodsError.message || "").includes("schema cache"))) {
        const fallback = await supabase
          .from("products")
          .select("id, name, price, category_id, barcode, low_stock_threshold")
          .eq("business_id", business.id)
          .order("name", { ascending: true })
        prods = fallback.data ?? null
        prodsError = fallback.error
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

      // Check which products have variants
      const productsWithVariants = new Set<string>()
      if (prods && prods.length > 0) {
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

      // Load stock from products_stock for active store only
      const activeStoreId = getActiveStoreId()
      const stockByProductId: Record<string, number> = {}

      if (activeStoreId && activeStoreId !== "all") {
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

      const formattedProducts = (prods || []).map((p) => {
        const hasVariants = productsWithVariants.has(p.id)
        const stockValue =
          activeStoreId && activeStoreId !== "all" && stockByProductId[p.id] !== undefined
            ? stockByProductId[p.id]
            : undefined

        return {
          id: p.id,
          name: p.name,
          price: Number(p.price || 0),
          category_id: p.category_id,
          barcode: p.barcode ?? null,
          stock: stockValue,
          low_stock_threshold: p.low_stock_threshold ? Number(p.low_stock_threshold) : undefined,
          hasVariants: hasVariants,
          tax_category: p.tax_category ?? undefined,
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
      <RetailBackofficeShell>
        <RetailBackofficeMain>
          <p className="text-sm text-slate-500">Loading catalog…</p>
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  if (workspaceMismatch) {
    return (
      <RetailBackofficeShell>
        <RetailBackofficeMain className="max-w-lg">
          <RetailBackofficePageHeader
            title="Products"
            description="This catalog is for retail businesses. Switch to a retail business in your workspace selector to manage products here."
          />
          <RetailBackofficeButton variant="primary" onClick={() => router.push(retailPaths.dashboard)}>
            Retail dashboard
          </RetailBackofficeButton>
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  /** Retail route only — service catalog is not loaded here */
  const isService = false
  const activeStoreId = getActiveStoreId()
  const hasStore = Boolean(activeStoreId && activeStoreId !== "all")

  const handleDelete = (productId: string, productName: string) => {
    setShowDeleteConfirm({ productId, productName })
  }

  const confirmDelete = async () => {
    if (!showDeleteConfirm) return

    try {
      const { error } = await supabase.from("products").delete().eq("id", showDeleteConfirm.productId)

      if (error) {
        setToast({ message: `Error deleting product: ${error.message}`, type: "error" })
        setShowDeleteConfirm(null)
        return
      }

      // Reload products after delete
      load()
      setToast({ message: `Product "${showDeleteConfirm.productName}" deleted successfully`, type: "success" })
      setShowDeleteConfirm(null)
    } catch (err: any) {
      setToast({ message: `Error deleting product: ${err.message}`, type: "error" })
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
    setEditVariantBarcode(variant.barcode?.trim() || "")
    setShowEditVariantModal(true)
  }

  const handleEditVariantSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!editingVariant) return

    const formData = new FormData(e.currentTarget)
    const newName = formData.get("variant_name")?.toString()?.trim() || ""
    const newSku = formData.get("sku")?.toString()?.trim() || ""
    const newBarcodeNorm = editVariantBarcode.trim()
    const prevBarcodeNorm = (editingVariant.barcode ?? "").trim()
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

    if (
      newName.trim() === editingVariant.variantName &&
      newPrice === editingVariant.price &&
      newSku === editingVariant.sku &&
      newBarcodeNorm === prevBarcodeNorm
    ) {
      setShowEditVariantModal(false)
      setEditingVariant(null)
      setEditVariantBarcode("")
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
      if (newBarcodeNorm !== prevBarcodeNorm) {
        updateData.barcode = newBarcodeNorm || null
      }

      if (Object.keys(updateData).length === 0) {
        setShowEditVariantModal(false)
        setEditingVariant(null)
        setEditVariantBarcode("")
        return
      }

      const { error } = await supabase
        .from("products_variants")
        .update(updateData)
        .eq("id", editingVariant.variantId)
        .eq("product_id", editingVariant.productId)

      if (error) {
        if (error.code === "23505") {
          setToast({
            message:
              "This variant barcode is already used on another variant in your business. Clear it or use a different barcode.",
            type: "error",
          })
          return
        }
        setToast({ message: `Error updating variant: ${error.message}`, type: "error" })
        return
      }

      // Reload variants for this product
      await loadVariantsForProduct(editingVariant.productId)
      setToast({ message: "Variant updated successfully", type: "success" })
      setShowEditVariantModal(false)
      setEditingVariant(null)
      setEditVariantBarcode("")
    } catch (err: any) {
      setToast({ message: `Error updating variant: ${err.message}`, type: "error" })
    }
  }

  const handleCreateVariant = (productId: string) => {
    setCreateVariantProductId(productId)
    setCreateVariantBarcode("")
    setShowCreateVariantModal(true)
  }

  const handleCreateVariantSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const variantName = formData.get("variant_name")?.toString().trim()
    const sku = formData.get("sku")?.toString().trim()
    const barcode = createVariantBarcode.trim()
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
        if (variantError.code === "23505") {
          setToast({
            message:
              "This variant barcode is already used on another variant in your business. Clear it or use a different barcode.",
            type: "error",
          })
          return
        }
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
      setCreateVariantBarcode("")
      setToast({ message: "Variant created successfully", type: "success" })
    } catch (err: any) {
      setToast({ message: `Error creating variant: ${err.message}`, type: "error" })
    }
  }

  const handleEdit = (productId: string) => {
    router.push(retailPaths.productEdit(productId))
  }

  const toggleVariants = async (productId: string) => {
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
    <RetailBackofficeShell>
      <RetailBackofficeMain>
        <RetailBackofficePageHeader
          eyebrow="Product & inventory"
          title="Products"
          description="Manage your catalog, pricing, and store-level stock. Search by name or barcode."
          actions={
            <>
              <RetailBackofficeButton variant="secondary" onClick={() => router.push(retailPaths.dashboard)}>
                Dashboard
              </RetailBackofficeButton>
              <RetailBackofficeButton variant="primary" onClick={() => router.push(retailPaths.productNew)}>
                New product
              </RetailBackofficeButton>
            </>
          }
        />

        {!hasStore ? (
          <RetailBackofficeAlert tone="warning" className="mb-6">
            Select an active store to view and adjust stock. Open a store from <strong>Stores</strong> first.
          </RetailBackofficeAlert>
        ) : null}

        {error ? (
          <div className="mb-6">
            <ErrorAlert message={error} onDismiss={() => setError("")} />
          </div>
        ) : null}

        <RetailBackofficeCard className="mb-6" padding="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="search"
              placeholder="Search by name or barcode…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn(retailFieldClass, "sm:flex-1")}
              autoComplete="off"
            />
            <div className="shrink-0 sm:min-w-[12rem]">
              <RetailMenuSelect
                value={categoryFilter}
                onValueChange={setCategoryFilter}
                size="lg"
                wrapperClassName="w-full"
                options={[
                  { value: "", label: "All categories" },
                  ...categories.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </div>
          </div>
        </RetailBackofficeCard>

        {/* Filter products by search and category */}
        {(() => {
          let list = products
          if (searchQuery.trim()) {
            const q = searchQuery.trim().toLowerCase()
            list = list.filter((p) => {
              const nameMatch = p.name.toLowerCase().includes(q)
              const barcodeMatch = (p.barcode || "").toLowerCase().includes(q)
              return nameMatch || barcodeMatch
            })
          }
          if (categoryFilter) {
            list = list.filter((p) => p.category_id === categoryFilter)
          }
          const filteredProducts = list

          if (filteredProducts.length === 0) {
            return (
              <RetailBackofficeEmpty
                title={searchQuery ? `No matches for “${searchQuery}”` : "No products yet"}
                description={
                  searchQuery
                    ? "Try another search or clear filters."
                    : "Add your first product to start selling on the POS."
                }
                action={
                  !searchQuery ? (
                    <RetailBackofficeButton variant="primary" onClick={() => router.push(retailPaths.productNew)}>
                      Create product
                    </RetailBackofficeButton>
                  ) : undefined
                }
              />
            )
          }

          return (
            <div className="space-y-4">
              {filteredProducts.map((product) => {
                const category = categories.find((c) => c.id === product.category_id)
                const stockDisplay = hasStore && product.stock !== undefined ? product.stock : hasStore ? 0 : undefined
                const isLowStock =
                  !product.hasVariants &&
                  hasStore && 
                  product.stock !== undefined && 
                  product.low_stock_threshold !== undefined && 
                  product.low_stock_threshold > 0 && 
                  product.stock <= product.low_stock_threshold

                return (
                  <RetailBackofficeCard
                    key={product.id}
                    padding="p-0"
                    className={cn(
                      "overflow-hidden transition-shadow hover:shadow-md",
                      isLowStock && "border-amber-200/90 bg-amber-50/35",
                    )}
                  >
                    <div className="p-5 sm:p-6">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold tracking-tight text-slate-900">{product.name}</h3>
                            {category ? (
                              <RetailBackofficeBadge tone="info">{category.name}</RetailBackofficeBadge>
                            ) : null}
                            {!isService && product.hasVariants ? (
                              <RetailBackofficeBadge tone="neutral">Variants</RetailBackofficeBadge>
                            ) : null}
                            {!isService && !product.hasVariants ? (
                              <button
                                type="button"
                                onClick={() => handleCreateVariant(product.id)}
                                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                                title="Add variants to this product"
                              >
                                + Variants
                              </button>
                            ) : null}
                            {isService && (product as any).tax_applicable !== undefined && (
                              <span
                                className={`rounded-lg border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                                  (product as any).tax_applicable
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                    : "border-slate-200 bg-slate-50 text-slate-700"
                                }`}
                              >
                                {(product as any).tax_applicable ? "Taxable" : "Non-taxable"}
                              </span>
                            )}
                            {isLowStock ? <RetailBackofficeBadge tone="warning">Low stock</RetailBackofficeBadge> : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
                            <span className="font-semibold tabular-nums text-slate-900">{format(product.price)}</span>
                            {product.barcode && (
                              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-700">
                                {product.barcode}
                              </span>
                            )}
                            {isService && (product as any).description && (
                              <span className="text-gray-500 italic">
                                {(product as any).description}
                              </span>
                            )}
                            {!isService && hasStore && !product.hasVariants && (
                              <span className={cn("tabular-nums", isLowStock && "font-medium text-amber-900")}>
                                On hand: {stockDisplay}
                                {product.low_stock_threshold && product.low_stock_threshold > 0 && (
                                  <span className="ml-1.5 text-slate-500">Reorder at {product.low_stock_threshold}</span>
                                )}
                              </span>
                            )}
                            {!isService && hasStore && product.hasVariants && (
                              <span className="font-medium text-slate-700">Stock per variant</span>
                            )}
                          </div>
                          {/* Variants toggle and list (retail only) */}
                          {!isService && product.hasVariants && (
                            <div className="mt-2">
                              <button
                                type="button"
                                onClick={() => toggleVariants(product.id)}
                                className="flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-slate-900"
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
                                <div className="ml-1 mt-3 space-y-3 border-l border-slate-200 pl-4">
                                  {variantsData[product.id].map((variant) => (
                                    <div key={variant.id} className="border-b border-slate-100 pb-3 text-sm last:border-0 last:pb-0">
                                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                                          <span className="font-medium text-slate-900">{variant.variant_name}</span>
                                          {variant.sku && (
                                            <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                                              {variant.sku}
                                            </span>
                                          )}
                                          {variant.barcode && (
                                            <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                                              {variant.barcode}
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
                                        <div className="flex shrink-0 gap-1.5">
                                          {hasStore && (
                                            <button
                                              type="button"
                                              onClick={() => handleAdjustStock(product, variant.id, variant.variant_name)}
                                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                                              title="Adjust stock"
                                            >
                                              Stock
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => handleEditVariant(product.id, variant.id, variant.variant_name, variant.price)}
                                            className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-medium text-white shadow-sm hover:bg-slate-800"
                                            title="Edit variant"
                                          >
                                            Edit
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                  <div className="pt-2">
                                    <button
                                      type="button"
                                      onClick={() => handleCreateVariant(product.id)}
                                      className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                                    >
                                      + Add variant
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          {!isService && hasStore && (
                            <>
                              {!product.hasVariants ? (
                                <button
                                  type="button"
                                  onClick={() => handleAdjustStock(product)}
                                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                                >
                                  Adjust stock
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled
                                  className="cursor-not-allowed rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-400"
                                  title="Stock is per variant — use the Stock button on each variant row below"
                                >
                                  Adjust stock
                                </button>
                              )}
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => handleEdit(product.id)}
                            className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(product.id, product.name)}
                            className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </RetailBackofficeCard>
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
            productBarcode={(() => {
              if (!selectedVariant) return selectedProduct.barcode ?? null
              const row = variantsData[selectedProduct.id]?.find((v) => v.id === selectedVariant.id)
              return (
                ((row?.barcode && row.barcode.trim()) ||
                  (row?.sku && row.sku.trim()) ||
                  selectedProduct.barcode) ??
                null
              )
            })()}
          />
        )}

        {/* Create Variant Modal (retail only) */}
        {!isService && showCreateVariantModal && createVariantProductId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4">
            <div className="max-h-[min(88vh,32rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-xl bg-white p-5 shadow-xl sm:p-6">
              <h2 className="mb-3 text-lg font-bold sm:text-xl">Create Variant</h2>
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
                  <RetailBarcodeFieldWithCamera
                    value={createVariantBarcode}
                    onChange={setCreateVariantBarcode}
                    inputClassName="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Optional barcode"
                    scanButtonClassName="inline-flex shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
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
                      setCreateVariantBarcode("")
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4">
            <div className="max-h-[min(88vh,32rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-xl bg-white p-5 shadow-xl sm:p-6">
              <h2 className="mb-3 text-lg font-bold sm:text-xl">Edit Variant</h2>
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
                  <RetailBarcodeFieldWithCamera
                    value={editVariantBarcode}
                    onChange={setEditVariantBarcode}
                    inputClassName="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Optional barcode"
                    scanButtonClassName="inline-flex shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
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
                      setEditVariantBarcode("")
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3 backdrop-blur-[2px] sm:p-4">
            <RetailBackofficeCard
              className="max-h-[min(88vh,24rem)] max-w-md overflow-y-auto overscroll-contain shadow-xl"
              padding="p-5 sm:p-6"
            >
              <h2 className="text-lg font-semibold text-slate-900">Delete product?</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                <span className="font-medium text-slate-800">{showDeleteConfirm.productName}</span> will be removed.
                This cannot be undone.
              </p>
              <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(null)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </RetailBackofficeCard>
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
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}
