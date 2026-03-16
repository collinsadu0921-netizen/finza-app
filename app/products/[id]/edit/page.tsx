"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { getActiveStoreId } from "@/lib/storeSession"
import { processProductImage } from "@/lib/imageProcessing"
import { useConfirm } from "@/components/ui/ConfirmProvider"

const TAX_CATEGORIES = ["taxable", "zero_rated", "exempt"] as const

type Category = {
  id: string
  name: string
}

export default function EditProductPage() {
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
    tax_category: "" as "" | "taxable" | "zero_rated" | "exempt",
  })
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [isService, setIsService] = useState(false)
  const [hasVariants, setHasVariants] = useState(false)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)

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

      const serviceMode = business.industry === "service"
      setIsService(serviceMode)

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
      const targetTable = serviceMode ? "products_services" : "products"

      if (serviceMode) {
        // Service: load from products_services by id + business_id
        const res = await supabase
          .from("products_services")
          .select("id, name, unit_price, category_id, description, tax_applicable")
          .eq("id", productId)
          .eq("business_id", business.id)
          .is("deleted_at", null)
          .single()
        product = res.data
        productError = res.error
      } else {
        // Retail: load from products (resilient to missing tax_category before migration 186)
        const productRes = await supabase
          .from("products")
          .select("id, name, price, cost_price, barcode, category_id, low_stock_threshold, image_url, tax_category")
          .eq("id", productId)
          .eq("business_id", business.id)
          .single()
        product = productRes.data
        productError = productRes.error
        if (productError && (String(productError.message || "").includes("tax_category") || String(productError.message || "").includes("schema cache"))) {
          const fallback = await supabase
            .from("products")
            .select("id, name, price, cost_price, barcode, category_id, low_stock_threshold, image_url")
            .eq("id", productId)
            .eq("business_id", business.id)
            .single()
          product = fallback.data
          productError = fallback.error
        }
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

      if (serviceMode) {
        setHasVariants(false)
      } else {
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
      }

      let currentStock = 0
      if (!serviceMode) {
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
      }

      if (serviceMode) {
        const priceVal = product.unit_price != null ? Number(product.unit_price) : 0
        setFormData({
          name: product.name || "",
          price: priceVal.toString(),
          cost_price: "",
          barcode: "",
          stock: "0",
          category_id: product.category_id || "",
          low_stock_threshold: "",
          tax_category: "",
        })
      } else {
        setFormData({
          name: product.name || "",
          price: product.price != null ? String(product.price) : "",
          cost_price: product.cost_price != null ? String(product.cost_price) : "",
          barcode: product.barcode || "",
          stock: currentStock.toString(),
          category_id: product.category_id || "",
          low_stock_threshold: product.low_stock_threshold != null ? String(product.low_stock_threshold) : "",
          tax_category: (product.tax_category && TAX_CATEGORIES.includes(product.tax_category as any))
            ? (product.tax_category as "taxable" | "zero_rated" | "exempt")
            : "",
        })
      }

      if (!serviceMode && product.image_url) {
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

    if (!isService && (!formData.tax_category || !TAX_CATEGORIES.includes(formData.tax_category))) {
      setError("Tax category is required. Please select taxable, zero-rated, or exempt.")
      return
    }

    setSaving(true)

    try {
      if (isService) {
        const { error: updateError } = await supabase
          .from("products_services")
          .update({
            name: formData.name.trim(),
            unit_price: parseFloat(formData.price),
            category_id: formData.category_id || null,
          })
          .eq("id", productId)
          .eq("business_id", businessId)

        if (updateError) {
          const logPayload = { message: updateError.message, code: updateError.code, details: updateError.details, hint: updateError.hint }
          console.error("Error updating service:", logPayload)
          setError(updateError.message || "Failed to update service.")
          setSaving(false)
          return
        }
        router.push("/products")
        return
      }

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
        setError(productError.message || "Failed to update product.")
        setSaving(false)
        return
      }

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

      router.push("/products")
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
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="p-6 max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Edit Product</h1>
          <button
            onClick={() => router.push("/products")}
            className="bg-gray-300 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-400"
          >
            Cancel
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-600">
            {error}
          </div>
        )}

        {hasVariants && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-yellow-800">
            <p className="font-medium">This product has variants.</p>
            <p className="text-sm mt-1">
              You can edit the parent stock here, but variant stock should be managed individually from the Products page.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Product Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
              placeholder="e.g., Coca Cola 500ml"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Price <span className="text-red-500">*</span>
                {hasVariants && <span className="text-xs text-gray-500 ml-1">(Base Price)</span>}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cost Price {hasVariants && <span className="text-xs text-gray-500">(Parent)</span>}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.cost_price}
                onChange={(e) => setFormData({ ...formData, cost_price: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="0.00"
                disabled={hasVariants}
              />
              {hasVariants ? (
                <div className="mt-1 space-y-1">
                  <p className="text-xs text-amber-600 font-medium">
                    ⚠️ This product has variants. Set cost price per variant below.
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Stock {hasVariants && <span className="text-xs text-gray-500">(Parent)</span>}
            </label>
            <input
              type="number"
              min="0"
              value={formData.stock}
              onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="0"
            />
            {hasVariants && (
              <p className="text-xs text-gray-500 mt-1">
                Note: Variants have their own stock. This is the parent product stock.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tax Category <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.tax_category}
                onChange={(e) => setFormData({ ...formData, tax_category: e.target.value as typeof formData.tax_category })}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              >
                <option value="">— Select —</option>
                <option value="taxable">Taxable</option>
                <option value="zero_rated">Zero-rated</option>
                <option value="exempt">Exempt</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category
              </label>
              <select
                value={formData.category_id}
                onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">No category</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Barcode/SKU
            </label>
            <input
              type="text"
              value={formData.barcode}
              onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Optional"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Low Stock Threshold
            </label>
            <input
              type="number"
              min="0"
              value={formData.low_stock_threshold}
              onChange={(e) => setFormData({ ...formData, low_stock_threshold: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Optional - alert when stock falls below this"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
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

          <div className="flex gap-4 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/products")}
              className="bg-gray-300 text-gray-800 px-6 py-2 rounded-lg hover:bg-gray-400 font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </ProtectedLayout>
  )
}

