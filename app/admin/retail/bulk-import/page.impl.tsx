"use client"

import { useState, useRef, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { getActiveStoreId } from "@/lib/storeSession"

const TAX_CATEGORIES = ["taxable", "zero_rated", "exempt"] as const

type CSVRow = {
  name: string
  sku: string
  category?: string
  price?: string
  cost_price?: string
  stock?: string
  low_stock_threshold?: string
  tax_category?: string
  variant_name?: string
  variant_sku?: string
  errors?: string[]
  warnings?: string[]
}

type ImportSummary = {
  created: number
  updated: number
  stockAdjustments: number
  errors: number
}

export default function BulkImportPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [hasAccess, setHasAccess] = useState(false)
  const [businessId, setBusinessId] = useState("")
  const [csvData, setCsvData] = useState<CSVRow[]>([])
  const [previewData, setPreviewData] = useState<CSVRow[]>([])
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 })
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [error, setError] = useState("")
  const [importIntent, setImportIntent] = useState<"products-only" | "products-stock">("products-only")

  useEffect(() => {
    checkAccess()
  }, [])

  const checkAccess = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Not authenticated")
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        return
      }

      setBusinessId(business.id)

      const role = await getUserRole(supabase, user.id, business.id)
      if (role !== "owner" && role !== "admin") {
        setError("Access denied. Only owners and admins can access bulk import.")
        return
      }

      setHasAccess(true)
    } catch (err: any) {
      setError(err.message || "Failed to check access")
    }
  }

  const parseCSVLine = (line: string): string[] => {
    const result: string[] = []
    let current = ""
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === "," && !inQuotes) {
        result.push(current.trim())
        current = ""
      } else {
        current += char
      }
    }
    result.push(current.trim())
    return result
  }

  const parseCSV = (text: string): CSVRow[] => {
    const lines = text.split("\n").filter((line) => line.trim())
    if (lines.length === 0) return []

    const headers = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""))
    const rows: CSVRow[] = []

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]).map((v) => v.replace(/^"|"$/g, "").trim())
      const row: CSVRow = {
        name: "",
        sku: "",
        errors: [],
        warnings: [],
      }

      headers.forEach((header, index) => {
        const value = values[index] || ""
        switch (header) {
          case "name":
            row.name = value
            break
          case "sku":
            row.sku = value
            break
          case "category":
            row.category = value || undefined
            break
          case "price":
            row.price = value || undefined
            break
          case "cost_price":
            row.cost_price = value || undefined
            break
          case "stock":
            row.stock = value || undefined
            break
          case "low_stock_threshold":
            row.low_stock_threshold = value || undefined
            break
          case "tax_category":
          case "taxcategory":
            row.tax_category = value?.trim() || undefined
            break
          case "variant_name":
            row.variant_name = value || undefined
            break
          case "variant_sku":
            row.variant_sku = value || undefined
            break
        }
      })

      if (row.name || row.sku) {
        rows.push(row)
      }
    }

    return rows
  }

  const validateCSV = (data: CSVRow[]): string[] => {
    const errors: string[] = []
    const skuSet = new Set<string>()

    data.forEach((row, index) => {
      const rowNum = index + 2 // +2 because index is 0-based and we skip header

      if (!row.name || row.name.trim() === "") {
        errors.push(`Row ${rowNum}: Missing required column "name"`)
        row.errors = row.errors || []
        row.errors.push("Missing name")
      }

      if (!row.sku || row.sku.trim() === "") {
        errors.push(`Row ${rowNum}: Missing required column "sku"`)
        row.errors = row.errors || []
        row.errors.push("Missing SKU")
      } else if (skuSet.has(row.sku)) {
        errors.push(`Row ${rowNum}: Duplicate SKU "${row.sku}"`)
        row.warnings = row.warnings || []
        row.warnings.push(`Duplicate SKU: ${row.sku}`)
      } else {
        skuSet.add(row.sku)
      }

      // Validate numeric fields
      if (row.price && isNaN(Number(row.price))) {
        errors.push(`Row ${rowNum}: Invalid price "${row.price}"`)
        row.errors = row.errors || []
        row.errors.push(`Invalid price: ${row.price}`)
      }

      if (row.cost_price && isNaN(Number(row.cost_price))) {
        errors.push(`Row ${rowNum}: Invalid cost_price "${row.cost_price}"`)
        row.errors = row.errors || []
        row.errors.push(`Invalid cost_price: ${row.cost_price}`)
      }

      if (row.stock && isNaN(Number(row.stock))) {
        errors.push(`Row ${rowNum}: Invalid stock "${row.stock}"`)
        row.errors = row.errors || []
        row.errors.push(`Invalid stock: ${row.stock}`)
      }

      if (row.low_stock_threshold && isNaN(Number(row.low_stock_threshold))) {
        errors.push(`Row ${rowNum}: Invalid low_stock_threshold "${row.low_stock_threshold}"`)
        row.errors = row.errors || []
        row.errors.push(`Invalid low_stock_threshold: ${row.low_stock_threshold}`)
      }

      if (!row.tax_category || row.tax_category.trim() === "") {
        errors.push(`Row ${rowNum}: Missing required "tax_category". Use taxable, zero_rated, or exempt.`)
        row.errors = row.errors || []
        row.errors.push("Missing tax_category")
      } else {
        const tc = row.tax_category.trim().toLowerCase()
        if (!TAX_CATEGORIES.includes(tc as (typeof TAX_CATEGORIES)[number])) {
          errors.push(`Row ${rowNum}: Invalid tax_category "${row.tax_category}". Use taxable, zero_rated, or exempt.`)
          row.errors = row.errors || []
          row.errors.push(`Invalid tax_category: ${row.tax_category}`)
        }
      }

      // Validate variant fields if provided
      if (row.variant_name && !row.sku) {
        errors.push(`Row ${rowNum}: variant_name provided but missing required "sku" (product SKU)`)
        row.errors = row.errors || []
        row.errors.push("variant_name requires product SKU")
      }
    })

    return errors
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setError("")
    setImportSummary(null)
    setValidationErrors([])

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string
        const parsed = parseCSV(text)
        setCsvData(parsed)
        setPreviewData(parsed.slice(0, 20))
        const errors = validateCSV(parsed)
        setValidationErrors(errors)
      } catch (err: any) {
        setError(`Failed to parse CSV: ${err.message}`)
      }
    }
    reader.readAsText(file)
  }

  const downloadTemplate = () => {
    const headers = "name,sku,category,price,cost_price,stock,low_stock_threshold,tax_category,variant_name,variant_sku"
    const blob = new Blob([headers], { type: "text/csv" })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "product_import_template.csv"
    a.click()
    window.URL.revokeObjectURL(url)
  }

  const handleImport = async () => {
    if (validationErrors.length > 0) {
      setError("Please fix validation errors before importing")
      return
    }

    if (csvData.length === 0) {
      setError("No data to import")
      return
    }

    setImporting(true)
    setError("")

    const summary: ImportSummary = {
      created: 0,
      updated: 0,
      stockAdjustments: 0,
      errors: 0,
    }

    try {
      // INVENTORY SAFETY: Bulk import has two modes to prevent accidental inventory modifications
      // Mode 1 (Products only): Creates/updates products, variants, categories ONLY
      //   - IGNORES all stock values in CSV
      //   - NEVER writes to products.stock, products.stock_quantity, or products_stock
      //   - Safe default: Products can be imported without affecting inventory
      //   - Products are sellable ONLY if valid products_stock rows exist (from other sources)
      //
      // Mode 2 (Products + stock): Requires explicit user selection
      //   - Requires active store_id (multi-store inventory safety)
      //   - Writes inventory ONLY to products_stock table (NEVER to products table)
      //   - This is critical: POS checkout and refunds read from products_stock, not products.stock
      //   - If we wrote to products.stock, checkout/refunds would desync from actual inventory
      let activeStoreId: string | null = null
      if (importIntent === "products-stock") {
        activeStoreId = getActiveStoreId()
        if (!activeStoreId || activeStoreId === 'all') {
          throw new Error("Products + stock mode requires a selected store. Go to Stores page and click 'Open Store', or switch to 'Products only' mode.")
        }
      }

      // Get all existing products and categories
      const { data: existingProducts } = await supabase
        .from("products")
        .select("id, barcode")
        .eq("business_id", businessId)

      const { data: existingCategories } = await supabase
        .from("categories")
        .select("id, name")
        .eq("business_id", businessId)

      // Load all variants for products (to check which products have variants)
      const productIds = existingProducts?.map((p) => p.id) || []
      const productsWithVariants = new Set<string>()
      const variantMap = new Map<string, { id: string; product_id: string }>() // variant_sku -> variant
      const variantNameMap = new Map<string, { id: string; product_id: string }>() // product_id + variant_name -> variant

      if (productIds.length > 0) {
        try {
          const { data: allVariants } = await supabase
            .from("products_variants")
            .select("id, product_id, variant_name, sku")
            .in("product_id", productIds)

          if (allVariants) {
            allVariants.forEach((v: any) => {
              productsWithVariants.add(v.product_id)
              if (v.sku) {
                variantMap.set(v.sku, { id: v.id, product_id: v.product_id })
              }
              const key = `${v.product_id}:${v.variant_name.toLowerCase()}`
              variantNameMap.set(key, { id: v.id, product_id: v.product_id })
            })
          }
        } catch (err: any) {
          // If table doesn't exist, continue without variant support
          if (
            err?.code !== "42P01" &&
            err?.code !== "42501" &&
            !err?.message?.includes("does not exist") &&
            !err?.message?.includes("schema cache")
          ) {
            console.error("Error loading variants:", err)
          }
        }
      }

      const productMap = new Map(existingProducts?.map((p) => [p.barcode || p.id, p]) || [])
      const categoryMap = new Map(existingCategories?.map((c) => [c.name.toLowerCase(), c.id]) || [])

      // Process each row
      for (let i = 0; i < csvData.length; i++) {
        const row = csvData[i]
        setImportProgress({ current: i + 1, total: csvData.length })
        try {
          // Handle category
          let categoryId: string | null = null
          if (row.category) {
            const categoryKey = row.category.toLowerCase()
            if (categoryMap.has(categoryKey)) {
              categoryId = categoryMap.get(categoryKey)!
            } else {
              // Create new category
              const { data: newCategory, error: catError } = await supabase
                .from("categories")
                .insert({
                  business_id: businessId,
                  name: row.category,
                })
                .select()
                .single()

              if (!catError && newCategory) {
                categoryId = newCategory.id
                categoryMap.set(categoryKey, categoryId)
              }
            }
          }

          const price = row.price ? Number(row.price) : null
          const costPrice = row.cost_price ? Number(row.cost_price) : null
          // Stock: only parse if explicitly provided (not empty string)
          const stock = row.stock !== undefined && row.stock !== "" ? Math.floor(Number(row.stock)) : null
          const lowStockThreshold = row.low_stock_threshold ? Math.floor(Number(row.low_stock_threshold)) : 0
          const taxCategory = row.tax_category?.trim().toLowerCase()
          if (!taxCategory || !TAX_CATEGORIES.includes(taxCategory as (typeof TAX_CATEGORIES)[number])) {
            throw new Error(`Row ${row.sku}: Invalid or missing tax_category. Use taxable, zero_rated, or exempt.`)
          }

          const existingProduct = productMap.get(row.sku)
          
          // Determine if this is a variant import
          const isVariantImport = !!(row.variant_name || row.variant_sku)
          let variantId: string | null = null

          if (existingProduct) {
            // Handle variant resolution if variant import
            if (isVariantImport) {
              // Find or create variant
              if (row.variant_sku) {
                const existingVariant = variantMap.get(row.variant_sku)
                if (existingVariant && existingVariant.product_id === existingProduct.id) {
                  variantId = existingVariant.id
                } else if (existingVariant && existingVariant.product_id !== existingProduct.id) {
                  throw new Error(`Variant SKU "${row.variant_sku}" belongs to a different product`)
                }
              }

              if (!variantId && row.variant_name) {
                const key = `${existingProduct.id}:${row.variant_name.toLowerCase()}`
                const existingVariant = variantNameMap.get(key)
                if (existingVariant) {
                  variantId = existingVariant.id
                }
              }

              // Create variant if it doesn't exist
              if (!variantId) {
                const variantPrice = row.price ? Number(row.price) : null
                const { data: newVariant, error: variantError } = await supabase
                  .from("products_variants")
                  .insert({
                    product_id: existingProduct.id,
                    variant_name: row.variant_name || "Unnamed Variant",
                    sku: row.variant_sku || null,
                    price: variantPrice,
                    cost_price: costPrice,
                  })
                  .select()
                  .single()

                if (variantError) {
                  throw new Error(`Failed to create variant: ${variantError.message}`)
                }

                variantId = newVariant?.id ?? null
                // Update maps for future lookups
                if (variantId && row.variant_sku) {
                  variantMap.set(row.variant_sku, { id: variantId, product_id: existingProduct.id })
                }
                const key = `${existingProduct.id}:${(row.variant_name || "Unnamed Variant").toLowerCase()}`
                if (variantId) {
                  variantNameMap.set(key, { id: variantId, product_id: existingProduct.id })
                }
              } else {
                // Update existing variant price/cost if provided
                const variantUpdateData: any = {}
                if (row.price !== undefined) variantUpdateData.price = row.price ? Number(row.price) : null
                if (row.cost_price !== undefined) variantUpdateData.cost_price = costPrice
                
                if (Object.keys(variantUpdateData).length > 0) {
                  const { error: variantUpdateError } = await supabase
                    .from("products_variants")
                    .update(variantUpdateData)
                    .eq("id", variantId)
                  
                  if (variantUpdateError) {
                    console.error("Error updating variant:", variantUpdateError)
                    // Don't fail import if variant update fails
                  }
                }
              }
            }

            // INVENTORY SAFETY: Validation for parent products with variants (Mode 2 only)
            // Mode 1 (Products only): No validation needed - stock values are ignored entirely
            // Mode 2 (Products + stock): Enforce variant inventory rules
            // CRITICAL RULE: Parent products with variants MUST NEVER receive stock
            // Stock must be assigned to variants (variant_id set), not parent (variant_id = null)
            // This prevents inventory desync: variants and parents are separate inventory records
            // POS checkout uses variant_id to find stock - parent stock would be ignored/incorrect
            if (importIntent === "products-stock") {
              // Check if product has variants (for non-variant imports)
              const productHasVariants = productsWithVariants.has(existingProduct.id)
              
              // VALIDATION: Reject stock import for parent products with variants (unless variant import)
              // This ensures inventory is correctly scoped to variants, not parent products
              if (!isVariantImport && productHasVariants && stock !== null) {
                throw new Error(`Product "${row.name}" has variants. Cannot set stock on parent product. Use variant_name or variant_sku to set variant stock.`)
              }
            }

            // INVENTORY SAFETY: Update product metadata only (NEVER stock fields)
            // We explicitly exclude stock/stock_quantity from product updates because:
            // 1. products_stock is the single source of truth for inventory (multi-store, variant-aware)
            // 2. POS checkout reads from products_stock, not products.stock
            // 3. Writing to products.stock would create desync between displayed and actual inventory
            // 4. Refunds would fail to restore correct stock if we wrote to the wrong table
            const updateData: any = {}
            if (row.price !== undefined && !isVariantImport) updateData.price = price
            if (row.cost_price !== undefined && !isVariantImport) updateData.cost_price = costPrice
            if (row.low_stock_threshold !== undefined) updateData.low_stock_threshold = lowStockThreshold
            if (row.category !== undefined) updateData.category_id = categoryId
            if (row.sku !== undefined) updateData.barcode = row.sku
            updateData.tax_category = taxCategory
            // NOTE: We deliberately do NOT include stock or stock_quantity here

            if (Object.keys(updateData).length > 0) {
              const { error: updateError } = await supabase
                .from("products")
                .update(updateData)
                .eq("id", existingProduct.id)

              if (updateError) throw updateError
            }

            // INVENTORY SAFETY: Stock writes are guarded by import intent
            // Mode 1 (Products only): This entire block is skipped - stock values in CSV are ignored
            // Mode 2 (Products + stock): Writes to products_stock ONLY (never products.stock)
            // Empty stock cells (stock === null) are skipped entirely - no inventory changes
            // This ensures products are sellable ONLY if valid products_stock rows exist
            if (importIntent === "products-stock" && stock !== null) {
              // Get current stock from products_stock
              let currentStock = 0
              let stockQuery = supabase
                .from("products_stock")
                .select("stock, stock_quantity")
                .eq("product_id", existingProduct.id)
                .eq("store_id", activeStoreId)
              
              if (variantId) {
                stockQuery = stockQuery.eq("variant_id", variantId)
              } else {
                stockQuery = stockQuery.is("variant_id", null)
              }
              
              const { data: currentStockData } = await stockQuery.maybeSingle()

              if (currentStockData) {
                currentStock = Math.floor(
                  currentStockData.stock_quantity !== null && currentStockData.stock_quantity !== undefined
                    ? Number(currentStockData.stock_quantity)
                    : currentStockData.stock !== null && currentStockData.stock !== undefined
                    ? Number(currentStockData.stock)
                    : 0
                )
              }

              // INVENTORY SAFETY: Write to products_stock ONLY (NEVER products.stock)
              // This is the single source of truth for inventory:
              // - Multi-store: stock is scoped by store_id
              // - Variants: stock is scoped by variant_id
              // - Simple products: variant_id = null
              // POS checkout and refunds read from products_stock, so we MUST write here
              // Writing to products.stock would break checkout/refund inventory tracking
              //
              // IDEMPOTENCY: Upsert ensures exactly one row per (product_id, variant_id, store_id)
              // Database has UNIQUE constraint on (product_id, variant_id, store_id)
              // Re-running the same import will UPDATE the existing row, not create duplicates
              // This guarantees POS checkout .single() queries always succeed when stock exists
              // variant_id is null for simple products, UUID for variants (PostgreSQL treats NULL as distinct)
              const { error: stockError } = await supabase
                .from("products_stock")
                .upsert({
                  product_id: existingProduct.id,
                  variant_id: variantId, // null for simple products, UUID for variants
                  store_id: activeStoreId,
                  stock: stock,
                  stock_quantity: stock,
                }, {
                  onConflict: "product_id,variant_id,store_id"
                })

              if (stockError) {
                throw new Error(`Failed to update stock: ${stockError.message}`)
              }

              // Log stock movement if stock changed
              if (stock !== currentStock) {
                const {
                  data: { user },
                } = await supabase.auth.getUser()

                await supabase.from("stock_movements").insert({
                  business_id: businessId,
                  product_id: existingProduct.id,
                  quantity_change: stock - currentStock,
                  type: "adjustment",
                  user_id: user?.id || "",
                  note: `Bulk Import${variantId ? ` - Variant: ${row.variant_name || row.variant_sku}` : ''}`,
                })

                summary.stockAdjustments++
              }
            }

            summary.updated++
          } else {
            // Create new product
            // AUTO-CREATE PARENT: For variant imports, automatically create parent product if missing
            // This allows variant imports without requiring parent product to exist first
            type ProductWithId = { id: string }
            let productToUse: ProductWithId | null = existingProduct ?? null

            if (isVariantImport && !existingProduct) {
              // INVENTORY SAFETY: Auto-create parent product for variant imports
              // We create the parent product but NEVER assign stock to it
              // Parent products with variants should NEVER have stock - variants track stock separately
              // We deliberately do NOT include stock or stock_quantity in this insert
              // Stock will be assigned to the variant (if Mode 2 is enabled), not the parent
              const {
                data: { user },
              } = await supabase.auth.getUser()

              const { data: newParentProduct, error: createParentError } = await supabase
                .from("products")
                .insert({
                  business_id: businessId,
                  name: row.name,
                  barcode: row.sku,
                  price: price || 0,
                  cost_price: costPrice,
                  low_stock_threshold: lowStockThreshold,
                  category_id: categoryId,
                  track_stock: true,
                  tax_category: taxCategory,
                  // NOTE: We deliberately do NOT include stock or stock_quantity here
                })
                .select()
                .single()

              if (createParentError) throw createParentError

              productToUse = newParentProduct as ProductWithId
              // Add to productMap for future lookups in same import
              productMap.set(row.sku, newParentProduct)
              // Mark as having variants (since we're about to create one)
              productsWithVariants.add(newParentProduct.id)

              summary.created++
            }

            if (!isVariantImport) {
              // INVENTORY SAFETY: Standard product creation (non-variant)
              // We create the product but NEVER assign stock to products.stock or products.stock_quantity
              // Stock will be assigned to products_stock (if Mode 2 is enabled), not the products table
              // This is critical: products_stock is the single source of truth for inventory
              // Writing to products.stock would break POS checkout and refunds
              const {
                data: { user },
              } = await supabase.auth.getUser()

              const { data: newProduct, error: createError } = await supabase
                .from("products")
                .insert({
                  business_id: businessId,
                  name: row.name,
                  barcode: row.sku,
                  price: price || 0,
                  cost_price: costPrice,
                  low_stock_threshold: lowStockThreshold,
                  category_id: categoryId,
                  track_stock: true,
                  tax_category: taxCategory,
                  // NOTE: We deliberately do NOT include stock or stock_quantity here
                })
                .select()
                .single()

              if (createError) throw createError
              productToUse = newProduct as ProductWithId
              summary.created++
            }

            // Handle variant creation/update if this is a variant import
            if (isVariantImport && productToUse) {
              // Resolve variant using same logic as existing product path
              if (row.variant_sku) {
                const existingVariant = variantMap.get(row.variant_sku)
                if (existingVariant && existingVariant.product_id === productToUse.id) {
                  variantId = existingVariant.id
                } else if (existingVariant && existingVariant.product_id !== productToUse.id) {
                  throw new Error(`Variant SKU "${row.variant_sku}" belongs to a different product`)
                }
              }

              if (!variantId && row.variant_name) {
                const key = `${productToUse.id}:${row.variant_name.toLowerCase()}`
                const existingVariant = variantNameMap.get(key)
                if (existingVariant) {
                  variantId = existingVariant.id
                }
              }

              // Create variant if it doesn't exist
              if (!variantId) {
                const variantPrice = row.price ? Number(row.price) : null
                const { data: newVariant, error: variantError } = await supabase
                  .from("products_variants")
                  .insert({
                    product_id: productToUse.id,
                    variant_name: row.variant_name || "Unnamed Variant",
                    sku: row.variant_sku || null,
                    price: variantPrice,
                    cost_price: costPrice,
                  })
                  .select()
                  .single()

                if (variantError) {
                  throw new Error(`Failed to create variant: ${variantError.message}`)
                }

                variantId = newVariant?.id ?? null
                // Update maps for future lookups
                if (variantId && row.variant_sku) {
                  variantMap.set(row.variant_sku, { id: variantId, product_id: productToUse.id })
                }
                const key = `${productToUse.id}:${(row.variant_name || "Unnamed Variant").toLowerCase()}`
                if (variantId) {
                  variantNameMap.set(key, { id: variantId, product_id: productToUse.id })
                }
              } else {
                // Update existing variant price/cost if provided
                const variantUpdateData: any = {}
                if (row.price !== undefined) variantUpdateData.price = row.price ? Number(row.price) : null
                if (row.cost_price !== undefined) variantUpdateData.cost_price = costPrice
                
                if (Object.keys(variantUpdateData).length > 0) {
                  const { error: variantUpdateError } = await supabase
                    .from("products_variants")
                    .update(variantUpdateData)
                    .eq("id", variantId)
                  
                  if (variantUpdateError) {
                    console.error("Error updating variant:", variantUpdateError)
                    // Don't fail import if variant update fails
                  }
                }
              }

              // INVENTORY SAFETY: Variant stock writes (Mode 2 only, guarded by intent)
              // Mode 1 (Products only): This block is skipped - variant stock in CSV is ignored
              // Mode 2 (Products + stock): Writes variant stock to products_stock with variant_id
              // CRITICAL: Stock is assigned to variant (variant_id set), NOT parent product (variant_id = null)
              // Parent products with variants NEVER receive stock - this would break variant inventory
              // Empty stock cells (stock === null) are skipped - no inventory changes
              if (importIntent === "products-stock" && stock !== null) {
                // Get current stock from products_stock for variant
                let currentStock = 0
                const { data: currentStockData } = await supabase
                  .from("products_stock")
                  .select("stock, stock_quantity")
                  .eq("product_id", productToUse.id)
                  .eq("variant_id", variantId)
                  .eq("store_id", activeStoreId)
                  .maybeSingle()

                if (currentStockData) {
                  currentStock = Math.floor(
                    currentStockData.stock_quantity !== null && currentStockData.stock_quantity !== undefined
                      ? Number(currentStockData.stock_quantity)
                      : currentStockData.stock !== null && currentStockData.stock !== undefined
                      ? Number(currentStockData.stock)
                      : 0
                  )
                }

                // INVENTORY SAFETY: Variant stock goes to products_stock with variant_id set
                // This is critical: variants track stock separately from parent products
                // POS checkout uses variant_id to find correct stock row
                // Parent products (variant_id = null) and variants (variant_id set) are separate inventory records
                //
                // IDEMPOTENCY: Upsert ensures exactly one row per (product_id, variant_id, store_id)
                // Database has UNIQUE constraint on (product_id, variant_id, store_id)
                // Re-running the same import will UPDATE the existing variant stock row, not create duplicates
                // variant_id is always set here (this is variant stock, not parent product stock)
                // This guarantees POS checkout .single() queries always succeed when variant stock exists
                const { error: stockError } = await supabase
                  .from("products_stock")
                  .upsert({
                    product_id: productToUse.id,
                    variant_id: variantId, // Always set for variants (not null)
                    store_id: activeStoreId,
                    stock: stock,
                    stock_quantity: stock,
                  }, {
                    onConflict: "product_id,variant_id,store_id"
                  })

                if (stockError) {
                  throw new Error(`Failed to create variant stock record: ${stockError.message}`)
                }

                // Log stock movement if stock changed
                if (stock !== currentStock) {
                  const {
                    data: { user },
                  } = await supabase.auth.getUser()

                  await supabase.from("stock_movements").insert({
                    business_id: businessId,
                    product_id: productToUse.id,
                    quantity_change: stock - currentStock,
                    type: "adjustment",
                    user_id: user?.id || "",
                    note: `Bulk Import - Variant: ${row.variant_name || row.variant_sku}`,
                  })

                  summary.stockAdjustments++
                }
              }

              summary.updated++
            } else if (!isVariantImport && productToUse) {
              // INVENTORY SAFETY: Simple product stock writes (Mode 2 only, guarded by intent)
              // Mode 1 (Products only): This block is skipped - stock values in CSV are completely ignored
              // Mode 2 (Products + stock): Writes simple product stock to products_stock (variant_id = null)
              // Empty stock cells (stock === null) are skipped - products created without inventory
              // Products are sellable ONLY if valid products_stock rows exist (from this import or other sources)
              if (importIntent === "products-stock" && stock !== null) {
                const {
                  data: { user },
                } = await supabase.auth.getUser()

                // INVENTORY SAFETY: Simple product stock goes to products_stock (variant_id = null)
                // This is the single source of truth for inventory - POS checkout reads from here
                // We NEVER write to products.stock because it would desync from actual inventory
                // products_stock is multi-store and variant-aware, products.stock is not
                //
                // IDEMPOTENCY: Upsert ensures exactly one row per (product_id, variant_id, store_id)
                // Database has UNIQUE constraint on (product_id, variant_id, store_id)
                // Re-running the same import will UPDATE the existing stock row, not create duplicates
                // variant_id is explicitly null for simple products (PostgreSQL treats NULL as distinct in UNIQUE constraints)
                // This guarantees POS checkout .single() queries always succeed when stock exists
                const { error: stockError } = await supabase
                  .from("products_stock")
                  .upsert({
                    product_id: productToUse.id,
                    variant_id: null, // Explicitly null for simple products (not variants)
                    store_id: activeStoreId,
                    stock: stock,
                    stock_quantity: stock,
                  }, {
                    onConflict: "product_id,variant_id,store_id"
                  })

                if (stockError) {
                  throw new Error(`Failed to create stock record: ${stockError.message}`)
                }

                // Log initial stock import (even if 0, it's an explicit import)
                await supabase.from("stock_movements").insert({
                  business_id: businessId,
                  product_id: productToUse.id,
                  quantity_change: stock,
                  type: "initial_import",
                  user_id: user?.id || "",
                  note: "Bulk Import",
                })

                summary.stockAdjustments++
              }
            }
          }
        } catch (err: any) {
          console.error(`Error processing row ${row.sku}:`, err)
          summary.errors++
        }
      }

      setImportSummary(summary)
      setCsvData([])
      setPreviewData([])
      setValidationErrors([])
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    } catch (err: any) {
      setError(`Import failed: ${err.message}`)
    } finally {
      setImporting(false)
    }
  }

  if (!hasAccess && !loading) {
    return (
      <>
        <div className="p-6 min-h-screen">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error || "Access denied"}
          </div>
          <button
            onClick={() => router.push("/retail/dashboard")}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Back to Dashboard
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="p-6 max-w-7xl mx-auto min-h-screen">
        <div className="mb-6">
          <button
            onClick={() => router.push("/retail/dashboard")}
            className="text-blue-600 hover:underline mb-4"
          >
            ← Back to Dashboard
          </button>
          <h1 className="text-2xl font-bold mb-2">Bulk Product Import</h1>
          <p className="text-gray-600">Import or update multiple products from a CSV file</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {importing && (
          <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded mb-4">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-700"></div>
              <div>
                <p className="font-semibold text-blue-700">Importing products...</p>
                <p className="text-sm text-blue-700">
                  Processing {importProgress.current} of {importProgress.total} rows
                </p>
                <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {importSummary && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
            <h3 className="font-semibold mb-2 text-green-700">Import Complete!</h3>
            <ul className="list-disc list-inside space-y-1">
              <li className="text-green-700">{importSummary.created} products created</li>
              <li className="text-green-700">{importSummary.updated} products updated</li>
              <li className="text-green-700">{importSummary.stockAdjustments} stock adjustments logged</li>
              {importSummary.errors > 0 && (
                <li className="text-red-600">{importSummary.errors} errors occurred</li>
              )}
            </ul>
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-md mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Upload CSV File</h2>
            <button
              onClick={downloadTemplate}
              className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 text-sm"
            >
              Download CSV Template
            </button>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Import Intent
            </label>
            <div className="space-y-2 mb-4">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="importIntent"
                  value="products-only"
                  checked={importIntent === "products-only"}
                  onChange={(e) => setImportIntent(e.target.value as "products-only" | "products-stock")}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                  disabled={importing}
                />
                <div>
                  <span className="font-medium text-gray-900">Products only (default, safe)</span>
                  <p className="text-xs text-gray-500">
                    Create/update products, variants, categories, prices. Stock values in CSV are completely ignored.
                  </p>
                </div>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="importIntent"
                  value="products-stock"
                  checked={importIntent === "products-stock"}
                  onChange={(e) => setImportIntent(e.target.value as "products-only" | "products-stock")}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                  disabled={importing}
                />
                <div>
                  <span className="font-medium text-gray-900">Products + stock (advanced)</span>
                  <p className="text-xs text-gray-500">
                    Requires active store selection. Imports stock to products_stock table. Empty stock cells are skipped.
                  </p>
                </div>
              </label>
            </div>

            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select CSV File
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            <p className="text-xs text-gray-500 mt-2">
              Required columns: name, sku, tax_category (taxable | zero_rated | exempt). Optional: category, price, cost_price, stock, low_stock_threshold, variant_name, variant_sku
            </p>
            {importIntent === "products-stock" && (
              <p className="text-xs text-yellow-600 mt-1">
                Note: Products + stock mode requires a selected store. Go to Stores page and click 'Open Store' before importing.
              </p>
            )}
            {importIntent === "products-only" && (
              <p className="text-xs text-gray-500 mt-1">
                Note: Products only mode ignores all stock values in CSV. Stock can be managed separately.
              </p>
            )}
          </div>

          {validationErrors.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded mb-4">
              <h3 className="font-semibold mb-2 text-yellow-700">Validation Errors ({validationErrors.length})</h3>
              <ul className="list-disc list-inside text-sm space-y-1 max-h-40 overflow-y-auto">
                {validationErrors.slice(0, 10).map((err, idx) => (
                  <li key={idx} className="text-yellow-700">{err}</li>
                ))}
                {validationErrors.length > 10 && (
                  <li className="font-semibold text-yellow-700">... and {validationErrors.length - 10} more errors</li>
                )}
              </ul>
            </div>
          )}

          {previewData.length > 0 && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-4">
                Preview (showing first {Math.min(20, previewData.length)} of {csvData.length} rows)
              </h3>
              <div className="overflow-x-auto border border-gray-200 rounded">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Name</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">SKU</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Category</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Price</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Cost Price</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Stock</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Low Stock</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Tax Category</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Variant Name</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Variant SKU</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {previewData.map((row, idx) => (
                      <tr
                        key={idx}
                        className={
                          row.errors && row.errors.length > 0
                            ? "bg-red-50"
                            : row.warnings && row.warnings.length > 0
                            ? "bg-yellow-50"
                            : ""
                        }
                      >
                        <td className="px-4 py-2">{row.name || "-"}</td>
                        <td className="px-4 py-2 font-mono text-xs">{row.sku || "-"}</td>
                        <td className="px-4 py-2">{row.category || "-"}</td>
                        <td className="px-4 py-2">{row.price || "-"}</td>
                        <td className="px-4 py-2">{row.cost_price || "-"}</td>
                        <td className="px-4 py-2">{row.stock !== undefined && row.stock !== "" ? row.stock : "-"}</td>
                        <td className="px-4 py-2">{row.low_stock_threshold || "0"}</td>
                        <td className="px-4 py-2">{row.tax_category || "-"}</td>
                        <td className="px-4 py-2">{row.variant_name || "-"}</td>
                        <td className="px-4 py-2 font-mono text-xs">{row.variant_sku || "-"}</td>
                        <td className="px-4 py-2">
                          {row.errors && row.errors.length > 0 && (
                            <span className="text-red-600 text-xs">Errors</span>
                          )}
                          {row.warnings && row.warnings.length > 0 && (
                            <span className="text-yellow-600 text-xs">Warnings</span>
                          )}
                          {(!row.errors || row.errors.length === 0) &&
                            (!row.warnings || row.warnings.length === 0) && (
                              <span className="text-green-600 text-xs">✓ Valid</span>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-4 mt-6">
                <button
                  onClick={() => {
                    setCsvData([])
                    setPreviewData([])
                    setValidationErrors([])
                    setImportSummary(null)
                    if (fileInputRef.current) {
                      fileInputRef.current.value = ""
                    }
                  }}
                  className="bg-gray-300 text-gray-800 px-6 py-2 rounded hover:bg-gray-400"
                  disabled={importing}
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing || validationErrors.length > 0 || csvData.length === 0}
                  className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {importing ? "Importing..." : `Import ${csvData.length} Products`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

