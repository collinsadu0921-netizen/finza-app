"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { retailPaths } from "@/lib/retail/routes"
import { getActiveStoreId } from "@/lib/storeSession"
import { processProductImage } from "@/lib/imageProcessing"
import { cn } from "@/lib/utils"
import RetailBarcodeFieldWithCamera from "@/components/retail/RetailBarcodeFieldWithCamera"
import { useConfirm } from "@/components/ui/ConfirmProvider"
import {
  RetailBackofficeAlert,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
  retailFieldClass,
  retailLabelClass,
  RetailMenuSelect,
  type MenuSelectOption,
} from "@/components/retail/RetailBackofficeUi"

const TAX_CATEGORIES = ["taxable", "zero_rated", "exempt"] as const

const EDIT_PRODUCT_TAX_OPTIONS: MenuSelectOption[] = [
  { value: "", label: "— Select —" },
  { value: "taxable", label: "Taxable" },
  { value: "zero_rated", label: "Zero-rated" },
  { value: "exempt", label: "Exempt" },
]

type Category = {
  id: string
  name: string
}

export default function RetailEditProductPage() {
  const router = useRouter()
  const params = useParams()
  const productId = params.id as string
  const { openConfirm } = useConfirm()

  const [formData, setFormData] = useState({
    name: "",
    price: "",
    cost_price: "",
    barcode: "",
    stock: "0",
    category_id: "",
    low_stock_threshold: "",
    track_stock: true,
    tax_category: "" as "" | "taxable" | "zero_rated" | "exempt",
  })
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [hasVariants, setHasVariants] = useState(false)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)

  const categoryMenuOptions = useMemo(() => {
    const head: MenuSelectOption[] = [{ value: "", label: "No category" }]
    return head.concat(categories.map((c) => ({ value: c.id, label: c.name })))
  }, [categories])

  useEffect(() => {
    loadData()
  }, [productId])

  const loadData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setLoading(false)
        return
      }

      setBusinessId(business.id)

      // Load categories
      const { data: cats, error: catsError } = await supabase
        .from("categories")
        .select("id, name")
        .eq("business_id", business.id)
        .order("name", { ascending: true })

      if (catsError) {
        const logPayload = { message: catsError.message, code: catsError.code, details: catsError.details, hint: catsError.hint }
        console.error("Error loading categories:", logPayload)
        throw catsError
      }
      setCategories(cats || [])

      let product: any = null
      let productError: any = null
      const targetTable = "products"

      const productRes = await supabase
        .from("products")
        .select("id, name, price, cost_price, barcode, category_id, low_stock_threshold, track_stock, image_url, tax_category")
        .eq("id", productId)
        .eq("business_id", business.id)
        .single()
      product = productRes.data
      productError = productRes.error
      if (productError && (String(productError.message || "").includes("tax_category") || String(productError.message || "").includes("schema cache"))) {
        const fallback = await supabase
          .from("products")
          .select("id, name, price, cost_price, barcode, category_id, low_stock_threshold, track_stock, image_url")
          .eq("id", productId)
          .eq("business_id", business.id)
          .single()
        product = fallback.data
        productError = fallback.error
      }

      if (productError) {
        const logPayload = {
          message: productError.message,
          code: productError.code,
          details: productError.details,
          hint: productError.hint,
          id: productId,
          business_id: business.id,
          industry: business.industry,
          targetTable,
        }
        console.error("Error loading product/service:", logPayload)
        const userMsg =
          productError.code === "PGRST116"
            ? "Product or service not found."
            : productError.code === "42501" || productError.code === "42P01"
              ? "You don't have access to this item."
              : productError.message || "Failed to load data."
        setError(userMsg)
        setLoading(false)
        return
      }
      if (!product) {
        setError("Product or service not found.")
        setLoading(false)
        return
      }

      try {
        const { data: variants } = await supabase
          .from("products_variants")
          .select("id")
          .eq("product_id", productId)
          .limit(1)
        setHasVariants(variants != null && variants.length > 0)
      } catch {
        setHasVariants(false)
      }

      let currentStock = 0
      const activeStoreId = getActiveStoreId()
      if (activeStoreId && activeStoreId !== "all") {
        const { data: stockRecord } = await supabase
          .from("products_stock")
          .select("stock, stock_quantity")
          .eq("product_id", productId)
          .eq("store_id", activeStoreId)
          .is("variant_id", null)
          .maybeSingle()
        if (stockRecord) {
          currentStock = Math.floor(
            stockRecord.stock_quantity != null && stockRecord.stock_quantity !== undefined
              ? Number(stockRecord.stock_quantity)
              : stockRecord.stock != null && stockRecord.stock !== undefined
                ? Number(stockRecord.stock)
                : 0
          )
        }
      }

      setFormData({
        name: product.name || "",
        price: product.price != null ? String(product.price) : "",
        cost_price: product.cost_price != null ? String(product.cost_price) : "",
        barcode: product.barcode || "",
        stock: currentStock.toString(),
        category_id: product.category_id || "",
        low_stock_threshold: product.low_stock_threshold != null ? String(product.low_stock_threshold) : "",
        track_stock: product.track_stock !== false,
        tax_category: (product.tax_category && TAX_CATEGORIES.includes(product.tax_category as any))
          ? (product.tax_category as "taxable" | "zero_rated" | "exempt")
          : "",
      })

      if (product.image_url) {
        setCurrentImageUrl(product.image_url)
        setImagePreview(product.image_url)
      }

      setLoading(false)
    } catch (err: unknown) {
      const ex = err as { message?: string; code?: string; details?: string; hint?: string; stack?: string }
      const logPayload = {
        message: ex?.message ?? (err && typeof err === "object" && "message" in err ? String((err as any).message) : undefined) ?? String(err),
        code: ex?.code,
        details: ex?.details,
        hint: ex?.hint,
        stack: ex?.stack,
      }
      console.error("Error loading data:", logPayload)
      const userMsg =
        ex?.code === "PGRST116"
          ? "Product or service not found."
          : ex?.code === "42501" || ex?.code === "42P01"
            ? "You don't have access to this item."
            : ex?.message ?? (typeof err === "object" && err != null && "message" in err ? String((err as any).message) : null) ?? "Failed to load data."
      setError(userMsg)
      setLoading(false)
    }
  }

  const uploadProductImage = async (productId: string) => {
    if (!imageFile || !businessId) return null

    try {
      // Determine file extension
      const fileExt = imageFile.type.includes('webp') ? 'webp' :
                     imageFile.type.includes('png') ? 'png' : 'jpg'
      
      const fileName = `${businessId}/product-${productId}.${fileExt}`
      
      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("business-assets")
        .upload(fileName, imageFile, {
          upsert: true,
          cacheControl: '3600',
          contentType: imageFile.type
        })

      if (uploadError) {
        console.error("Upload error:", uploadError)
        throw new Error("Unable to upload image right now. Please try again. If it continues, contact support.")
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("business-assets")
        .getPublicUrl(fileName)

      return publicUrl
    } catch (err: any) {
      console.error("Error uploading image:", err)
      throw err
    }
  }

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !businessId) return

    setUploadingImage(true)
    setError("")

    try {
      // Process image (crop, resize, compress)
      const processed = await processProductImage(file)
      
      // Create preview
      setImagePreview(processed.url)
      setImageFile(processed.blob as any)

      setUploadingImage(false)
    } catch (err: any) {
      console.error("Error processing image:", err)
      setError("Unable to process image. Please try again.")
      setUploadingImage(false)
      setImageFile(null)
      if (currentImageUrl) {
        setImagePreview(currentImageUrl)
      } else {
        setImagePreview(null)
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
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

    if (!formData.tax_category || !TAX_CATEGORIES.includes(formData.tax_category)) {
      setError("Tax category is required. Please select taxable, zero-rated, or exempt.")
      return
    }

    setSaving(true)

    try {
      const activeStoreId = getActiveStoreId()
      if (!activeStoreId || activeStoreId === "all") {
        throw new Error("Please select a store before saving")
      }

      let finalImageUrl = currentImageUrl
      if (imageFile) {
        try {
          finalImageUrl = await uploadProductImage(productId)
        } catch (imgErr: unknown) {
          const m = (imgErr as { message?: string })?.message ?? String(imgErr)
          console.error("Error uploading image:", { message: m })
          throw new Error("Unable to upload image right now. Please try again. If it continues, contact support.")
        }
      }

      const updateData: any = {
        name: formData.name.trim(),
        price: parseFloat(formData.price),
        cost_price: formData.cost_price ? parseFloat(formData.cost_price) : null,
        barcode: formData.barcode.trim() || null,
        category_id: formData.category_id || null,
        image_url: finalImageUrl,
        tax_category: formData.tax_category,
        track_stock: formData.track_stock,
      }
      if (formData.low_stock_threshold) {
        updateData.low_stock_threshold = parseInt(formData.low_stock_threshold) || null
      } else {
        updateData.low_stock_threshold = null
      }

      const { error: productError } = await supabase
        .from("products")
        .update(updateData)
        .eq("id", productId)
        .eq("business_id", businessId)

      if (productError) {
        const logPayload = { message: productError.message, code: productError.code, details: productError.details, hint: productError.hint }
        console.error("Error updating product:", logPayload)
        if (productError.code === "23505") {
          setError(
            "This barcode is already used by another product in your business. Clear it or use a different barcode.",
          )
        } else {
          setError(productError.message || "Failed to update product.")
        }
        setSaving(false)
        return
      }

      if (!hasVariants) {
        const stockQty = parseInt(formData.stock) || 0
        const { data: existingStock } = await supabase
          .from("products_stock")
          .select("id")
          .eq("product_id", productId)
          .eq("store_id", activeStoreId)
          .is("variant_id", null)
          .maybeSingle()

        if (existingStock?.id) {
          const { error: stockError } = await supabase
            .from("products_stock")
            .update({ stock: stockQty, stock_quantity: stockQty })
            .eq("id", existingStock.id)
          if (stockError) throw stockError
        } else {
          const { error: stockError } = await supabase
            .from("products_stock")
            .insert({
              product_id: productId,
              store_id: activeStoreId,
              variant_id: null,
              stock: stockQty,
              stock_quantity: stockQty,
            })
          if (stockError) throw stockError
        }
      }

      router.push(retailPaths.products)
    } catch (err: unknown) {
      const ex = err as { message?: string; code?: string; details?: string; hint?: string }
      const logPayload = {
        message: ex?.message ?? (err && typeof err === "object" && "message" in err ? String((err as any).message) : undefined) ?? String(err),
        code: ex?.code,
        details: ex?.details,
        hint: ex?.hint,
      }
      console.error("Error updating product:", logPayload)
      setError(ex?.message ?? (typeof err === "object" && err != null && "message" in err ? String((err as any).message) : null) ?? "Failed to update product.")
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <RetailBackofficeShell>
        <RetailBackofficeMain className="max-w-2xl">
          <p className="text-sm text-slate-500">Loading…</p>
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain className="max-w-2xl">
        <RetailBackofficePageHeader
          eyebrow="Products"
          title="Edit product"
          description={
            hasVariants
              ? "Update catalog details for the active store. Sellable stock is kept per variant on the Products list."
              : "Update catalog details and store-level stock for the active store."
          }
          actions={
            <RetailBackofficeButton variant="secondary" onClick={() => router.push(retailPaths.products)}>
              Cancel
            </RetailBackofficeButton>
          }
        />

        {error ? (
          <RetailBackofficeAlert tone="error" className="mb-6">
            {error}
          </RetailBackofficeAlert>
        ) : null}

        {hasVariants ? (
          <RetailBackofficeAlert tone="info" className="mb-6">
            <p className="font-medium text-slate-900">This product has variants</p>
            <p className="mt-1 text-sm text-slate-700">
              POS and low-stock alerts use each variant&apos;s stock. Use{" "}
              <strong>Products</strong> → expand this product → <strong>Stock</strong> on each variant to change
              on-hand quantity. You do not need to maintain a separate &quot;parent&quot; quantity for sales.
            </p>
          </RetailBackofficeAlert>
        ) : null}

        <RetailBackofficeCard>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className={retailLabelClass}>
              Product Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className={retailFieldClass}
              required
              placeholder="e.g., Coca Cola 500ml"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={retailLabelClass}>
                Price <span className="text-red-500">*</span>
                {hasVariants && <span className="text-xs text-gray-500 ml-1">(Base Price)</span>}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                className={retailFieldClass}
                required
                placeholder="0.00"
              />
              {hasVariants ? (
                <p className="text-xs text-gray-500 mt-1">
                  Base/default price for variants. Variants can override this with their own price.
                </p>
              ) : (
                <p className="text-xs text-gray-500 mt-1">Selling price for this product</p>
              )}
            </div>

            <div>
              <label className={retailLabelClass}>
                Cost Price {hasVariants && <span className="text-xs text-gray-500">(Parent)</span>}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.cost_price}
                onChange={(e) => setFormData({ ...formData, cost_price: e.target.value })}
                className={cn(retailFieldClass, hasVariants && "bg-slate-50 text-slate-400")}
                placeholder="0.00"
                disabled={hasVariants}
              />
              {hasVariants ? (
                <div className="mt-1 space-y-1">
                  <p className="text-xs font-medium text-amber-800">
                    This product has variants. Set cost price per variant on the Products list.
                  </p>
                  <p className="text-xs text-gray-500">
                    Parent cost price is not used when variants exist. Each variant should have its own cost price.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-gray-500 mt-1">
                  Used for COGS (Cost of Goods Sold) calculation. This is what you paid to acquire/manufacture this product.
                </p>
              )}
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <input
              id="edit_track_stock"
              type="checkbox"
              checked={formData.track_stock}
              onChange={(e) => setFormData({ ...formData, track_stock: e.target.checked })}
              className="mt-1 h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="edit_track_stock" className="text-sm text-slate-800 cursor-pointer">
              <span className="font-medium">Track stock for this product</span>
              <span className="block text-slate-600 mt-0.5">
                When off, POS does not treat this item as stock-limited.
              </span>
            </label>
          </div>

          {!hasVariants ? (
            <div>
              <label className={retailLabelClass}>On-hand at this store</label>
              <input
                type="number"
                min="0"
                value={formData.stock}
                onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                disabled={!formData.track_stock}
                className={cn(retailFieldClass, !formData.track_stock && "bg-slate-50 text-slate-400")}
                placeholder="0"
              />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={retailLabelClass}>
                Tax Category <span className="text-red-500">*</span>
              </label>
              <RetailMenuSelect
                value={formData.tax_category}
                onValueChange={(v) => setFormData({ ...formData, tax_category: v as typeof formData.tax_category })}
                options={EDIT_PRODUCT_TAX_OPTIONS}
              />
            </div>

            <div>
              <label className={retailLabelClass}>
                Category
              </label>
              <RetailMenuSelect
                value={formData.category_id}
                onValueChange={(v) => setFormData({ ...formData, category_id: v })}
                options={categoryMenuOptions}
              />
            </div>
          </div>

          <div>
            <label className={retailLabelClass}>
              Barcode (unique per business when set)
            </label>
            <RetailBarcodeFieldWithCamera
              value={formData.barcode}
              onChange={(barcode) => setFormData({ ...formData, barcode })}
              inputClassName={retailFieldClass}
              placeholder="Optional"
            />
          </div>

          <div>
            <label className={retailLabelClass}>
              Low-stock alert threshold
              {hasVariants ? (
                <span className="ml-1 text-xs font-normal text-slate-500">(each variant)</span>
              ) : null}
            </label>
            <input
              type="number"
              min="0"
              value={formData.low_stock_threshold}
              onChange={(e) => setFormData({ ...formData, low_stock_threshold: e.target.value })}
              disabled={!formData.track_stock}
              className={cn(retailFieldClass, !formData.track_stock && "bg-slate-50 text-slate-400")}
              placeholder="Optional - alert when stock falls below this"
            />
            {hasVariants ? (
              <p className="mt-1 text-xs text-slate-500">
                Compared to each variant&apos;s on-hand quantity for low-stock reports and buy-list hints.
              </p>
            ) : null}
          </div>

          <div>
            <label className={retailLabelClass}>
              Product Image
            </label>
            <div className="space-y-2">
              {imagePreview && (
                <div className="relative w-32 h-32 border border-gray-300 rounded-lg overflow-hidden">
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setImagePreview(currentImageUrl)
                      setImageFile(null)
                    }}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600"
                  >
                    ×
                  </button>
                </div>
              )}
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                onChange={handleImageChange}
                disabled={uploadingImage}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
              />
              <p className="text-xs text-gray-500">
                {uploadingImage ? "Processing image..." : "Optional - JPG, PNG, or WebP (max 5MB). Image will be cropped to square and compressed."}
              </p>
              {currentImageUrl && !imageFile && (
                <button
                  type="button"
                  onClick={() => {
                    openConfirm({
                      title: "Remove product image",
                      description: "Are you sure you want to remove the product image?",
                      onConfirm: async () => {
                        await supabase
                          .from("products")
                          .update({ image_url: null })
                          .eq("id", productId)
                        setCurrentImageUrl(null)
                        setImagePreview(null)
                      },
                    })
                  }}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  Remove Image
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-6 sm:flex-row sm:justify-end">
            <RetailBackofficeButton variant="secondary" onClick={() => router.push(retailPaths.products)}>
              Cancel
            </RetailBackofficeButton>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
        </RetailBackofficeCard>
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}

