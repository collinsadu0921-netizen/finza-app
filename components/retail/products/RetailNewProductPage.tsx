"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"

const TAX_CATEGORIES = ["taxable", "zero_rated", "exempt"] as const
import { getCurrentBusiness } from "@/lib/business"
import { retailPaths } from "@/lib/retail/routes"
import {
  RetailBackofficeAlert,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeSectionTitle,
  RetailBackofficeShell,
  retailFieldClass,
  retailLabelClass,
  RetailMenuSelect,
  type MenuSelectOption,
} from "@/components/retail/RetailBackofficeUi"
import { getActiveStoreId } from "@/lib/storeSession"
import { processProductImage } from "@/lib/imageProcessing"
import { cn } from "@/lib/utils"

type Category = {
  id: string
  name: string
}

const NEW_PRODUCT_TAX_OPTIONS: MenuSelectOption[] = [
  { value: "", label: "Select…" },
  { value: "taxable", label: "Taxable" },
  { value: "zero_rated", label: "Zero-rated" },
  { value: "exempt", label: "Exempt" },
]

export default function RetailNewProductPage() {
  const router = useRouter()
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
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)

  const categoryMenuOptions = useMemo(() => {
    const head: MenuSelectOption[] = [{ value: "", label: "No category" }]
    return head.concat(categories.map((c) => ({ value: c.id, label: c.name })))
  }, [categories])

  useEffect(() => {
    loadData()
  }, [])

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

      if (catsError) throw catsError
      setCategories(cats || [])
      setLoading(false)
    } catch (err: any) {
      console.error("Error loading data:", err)
      setError(err.message || "Failed to load data")
      setLoading(false)
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
      if (!activeStoreId || activeStoreId === 'all') {
        throw new Error("Please select a store before creating a product")
      }

      // Create product first (without image)
      let lowParsed: number | null = null
      if (formData.low_stock_threshold.trim() !== "") {
        const t = parseInt(formData.low_stock_threshold, 10)
        if (!Number.isNaN(t) && t >= 0) lowParsed = t
      }

      const { data: newProduct, error: productError } = await supabase
        .from("products")
        .insert({
          business_id: businessId,
          name: formData.name.trim(),
          price: parseFloat(formData.price),
          cost_price: formData.cost_price ? parseFloat(formData.cost_price) : null,
          barcode: formData.barcode.trim() || null,
          category_id: formData.category_id || null,
          track_stock: formData.track_stock,
          low_stock_threshold: lowParsed,
          tax_category: formData.tax_category,
        })
        .select()
        .single()

      if (productError) {
        if (productError.code === "23505") {
          throw new Error(
            "This barcode is already used by another product in your business. Clear it or use a different barcode.",
          )
        }
        throw productError
      }

      // Upload image after product is created
      if (imageFile) {
        try {
          const finalImageUrl = await uploadProductImage(newProduct.id)
          
          // Update product with image URL
          if (finalImageUrl) {
            await supabase
              .from("products")
              .update({ image_url: finalImageUrl })
              .eq("id", newProduct.id)
          }
        } catch (imgErr: any) {
          console.error("Error uploading image:", imgErr)
          setError("Product created but image could not be uploaded. You can add an image later by editing the product.")
        }
      }

      // Create products_stock row for active store (even when not tracked, row keeps POS data consistent)
      const initialQty = formData.track_stock ? parseInt(formData.stock, 10) || 0 : 0
      const { error: stockError } = await supabase.from("products_stock").insert({
        product_id: newProduct.id,
        store_id: activeStoreId,
        stock: initialQty,
        stock_quantity: initialQty,
      })

      if (stockError) throw stockError

      // Redirect back to retail products page
      router.push(retailPaths.products)
    } catch (err: any) {
      console.error("Error creating product:", err)
      setError(err.message || "Failed to create product")
      setSaving(false)
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

      // Upload to storage (we'll get product ID after creation, so store temporarily)
      // For now, we'll upload after product is created
      setUploadingImage(false)
    } catch (err: any) {
      console.error("Error processing image:", err)
      setError("Unable to process image. Please try again.")
      setUploadingImage(false)
      setImageFile(null)
      setImagePreview(null)
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
          title="New product"
          description="Define how this item appears at the register, how it is taxed, and how stock is tracked for the active store."
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

        <RetailBackofficeCard>
          <form onSubmit={handleSubmit} className="space-y-8">
            <div>
              <RetailBackofficeSectionTitle>Basic information</RetailBackofficeSectionTitle>
              <div className="space-y-4">
                <div>
                  <label className={retailLabelClass}>
                    Product name <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className={retailFieldClass}
                    required
                    placeholder="e.g. Still water 500ml"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={retailLabelClass}>
                      Tax category <span className="text-red-600">*</span>
                    </label>
                    <RetailMenuSelect
                      value={formData.tax_category}
                      onValueChange={(v) =>
                        setFormData({ ...formData, tax_category: v as typeof formData.tax_category })
                      }
                      options={NEW_PRODUCT_TAX_OPTIONS}
                    />
                  </div>
                  <div>
                    <label className={retailLabelClass}>Category</label>
                    <RetailMenuSelect
                      value={formData.category_id}
                      onValueChange={(v) => setFormData({ ...formData, category_id: v })}
                      options={categoryMenuOptions}
                    />
                  </div>
                </div>
                <div>
                  <label className={retailLabelClass}>Barcode (optional, unique per business)</label>
                  <input
                    type="text"
                    value={formData.barcode}
                    onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                    className={retailFieldClass}
                    placeholder="Scan or type barcode"
                  />
                </div>
              </div>
            </div>

            <div>
              <RetailBackofficeSectionTitle>Pricing</RetailBackofficeSectionTitle>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={retailLabelClass}>
                    Selling price <span className="text-red-600">*</span>
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
                </div>
                <div>
                  <label className={retailLabelClass}>Cost price</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.cost_price}
                    onChange={(e) => setFormData({ ...formData, cost_price: e.target.value })}
                    className={retailFieldClass}
                    placeholder="0.00"
                  />
                  <p className="mt-1.5 text-xs text-slate-500">Used for margin and COGS where available.</p>
                </div>
              </div>
            </div>

            <div>
              <RetailBackofficeSectionTitle>Inventory at this store</RetailBackofficeSectionTitle>
              <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <input
                  id="track_stock"
                  type="checkbox"
                  checked={formData.track_stock}
                  onChange={(e) => setFormData({ ...formData, track_stock: e.target.checked })}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                />
                <label htmlFor="track_stock" className="cursor-pointer text-sm leading-snug text-slate-800">
                  <span className="font-medium">Track stock for this product</span>
                  <span className="mt-1 block text-slate-600">
                    When off, the POS will not treat this item as quantity-limited (e.g. services).
                  </span>
                </label>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={retailLabelClass}>
                    Initial on-hand {formData.track_stock ? "" : "(not tracked)"}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formData.stock}
                    onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                    disabled={!formData.track_stock}
                    className={cn(retailFieldClass, !formData.track_stock && "bg-slate-50 text-slate-400")}
                    placeholder="0"
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    For a simple SKU this is sellable quantity. If you add variants later, each variant gets its own
                    stock; you then maintain quantity on each variant line, not this starting parent row.
                  </p>
                </div>
                <div>
                  <label className={retailLabelClass}>Low-stock alert (optional)</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.low_stock_threshold}
                    onChange={(e) => setFormData({ ...formData, low_stock_threshold: e.target.value })}
                    disabled={!formData.track_stock}
                    className={cn(retailFieldClass, !formData.track_stock && "bg-slate-50 text-slate-400")}
                    placeholder="Alert when at or below"
                  />
                </div>
              </div>
            </div>

            <div>
              <RetailBackofficeSectionTitle>Image (optional)</RetailBackofficeSectionTitle>
              <div className="space-y-3">
                {imagePreview && (
                  <div className="relative h-32 w-32 overflow-hidden rounded-xl border border-slate-200 shadow-sm">
                    <img src={imagePreview} alt="Preview" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => {
                        setImagePreview(null)
                        setImageFile(null)
                      }}
                      className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-slate-900/85 text-sm text-white hover:bg-slate-900"
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
                  className={cn(
                    retailFieldClass,
                    "text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-slate-200",
                  )}
                />
                <p className="text-xs text-slate-500">
                  {uploadingImage
                    ? "Processing image…"
                    : "JPG, PNG, or WebP — square crop and compression applied on upload."}
                </p>
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
                {saving ? "Creating…" : "Create product"}
              </button>
            </div>
          </form>
        </RetailBackofficeCard>
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}
