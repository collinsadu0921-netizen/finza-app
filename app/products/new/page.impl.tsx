"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"

const TAX_CATEGORIES = ["taxable", "zero_rated", "exempt"] as const
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { getActiveStoreId } from "@/lib/storeSession"
import { processProductImage } from "@/lib/imageProcessing"

type Category = {
  id: string
  name: string
}

export default function NewProductPage() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    name: "",
    price: "",
    cost_price: "",
    barcode: "",
    stock: "0",
    category_id: "",
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
      const { data: newProduct, error: productError } = await supabase
        .from("products")
        .insert({
          business_id: businessId,
          name: formData.name.trim(),
          price: parseFloat(formData.price),
          cost_price: formData.cost_price ? parseFloat(formData.cost_price) : null,
          barcode: formData.barcode.trim() || null,
          category_id: formData.category_id || null,
          track_stock: true,
          tax_category: formData.tax_category,
        })
        .select()
        .single()

      if (productError) throw productError

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

      // Redirect back to retail products page
      router.push("/retail/products")
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
          <h1 className="text-2xl font-bold">Create Product</h1>
          <button
            onClick={() => router.push("/retail/products")}
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
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cost Price
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.cost_price}
                onChange={(e) => setFormData({ ...formData, cost_price: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="0.00"
              />
              <p className="text-xs text-gray-500 mt-1">Used for COGS calculation</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Initial Stock
            </label>
            <input
              type="number"
              min="0"
              value={formData.stock}
              onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="0"
            />
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
                      setImagePreview(null)
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
            </div>
          </div>

          <div className="flex gap-4 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Creating..." : "Create Product"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/retail/products")}
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
