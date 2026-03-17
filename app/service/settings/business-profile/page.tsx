"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { useToast } from "@/components/ui/ToastProvider"
import DateInput from "@/components/ui/DateInput"

export default function ServiceBusinessProfilePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [businessIndustry, setBusinessIndustry] = useState("")

  const returnPath = searchParams?.get("return") || null

  const [formData, setFormData] = useState({
    legal_name: "",
    trading_name: "",
    address_street: "",
    address_city: "",
    address_region: "",
    address_country: "",
    phone: "",
    whatsapp_phone: "",
    email: "",
    website: "",
    tin: "",
    logo_url: "",
    default_currency: "",
    start_date: "",
  })

  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  const handleChange = useCallback((field: keyof typeof formData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }, [])

  useEffect(() => {
    loadBusinessProfile()
  }, [])

  const loadBusinessProfile = async () => {
    try {
      setLoading(true)
      setError("")

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push("/login")
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }

      setBusinessId(business.id)

      const response = await fetch(`/api/business/profile?business_id=${encodeURIComponent(business.id)}`)
      if (!response.ok) {
        throw new Error("Failed to load business profile")
      }

      const { business: businessData } = await response.json()

      setFormData({
        legal_name: businessData.legal_name || "",
        trading_name: businessData.trading_name || "",
        address_street: businessData.address_street || "",
        address_city: businessData.address_city || "",
        address_region: businessData.address_region || "",
        address_country: businessData.address_country || "",
        phone: businessData.phone || "",
        whatsapp_phone: businessData.whatsapp_phone || "",
        email: businessData.email || "",
        website: businessData.website || "",
        tin: businessData.tin || "",
        logo_url: businessData.logo_url || "",
        default_currency: businessData.default_currency || "",
        start_date: businessData.start_date ? new Date(businessData.start_date).toISOString().split("T")[0] : "",
      })

      if (businessData.logo_url) setLogoPreview(businessData.logo_url)
      setBusinessIndustry(businessData.industry || "")
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load business profile")
      setLoading(false)
    }
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !businessId) return

    const allowedTypes = ["image/png", "image/jpeg", "image/webp"]
    if (!allowedTypes.includes(file.type) || file.size > 2 * 1024 * 1024) {
      const message = "Logo must be PNG, JPG, or WebP under 2MB"
      toast.showToast(message, "error")
      setError(message)
      return
    }

    const previewUrl = URL.createObjectURL(file)
    setLogoPreview(previewUrl)

    try {
      const fileExt = file.name.split(".").pop()?.toLowerCase() || "png"
      const filePath = `business-logos/${businessId}/${Date.now()}.${fileExt}`

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("business-assets")
        .upload(filePath, file, { cacheControl: "3600", contentType: file.type, upsert: false })

      if (uploadError || !uploadData) throw new Error("Logo upload failed")

      const { data: { publicUrl } } = supabase.storage.from("business-assets").getPublicUrl(filePath)
      const { error: updateError } = await supabase.from("businesses").update({ logo_url: publicUrl }).eq("id", businessId)
      if (updateError) throw updateError

      setFormData((prev) => ({ ...prev, logo_url: publicUrl }))
      setSuccess("Logo uploaded successfully!")
      toast.showToast("Logo uploaded successfully!", "success")
    } catch {
      setError("Logo upload failed. Please try again.")
      toast.showToast("Logo upload failed. Please try again.", "error")
    } finally {
      try {
        URL.revokeObjectURL(previewUrl)
      } catch {
        // noop
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSuccess("")

    if (!formData.address_country) {
      setError("Country is required.")
      return
    }
    if (!formData.default_currency) {
      setError("Default currency is required.")
      return
    }

    try {
      setSaving(true)
      const response = await fetch("/api/business/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, business_id: businessId }),
      })
      const json = await response.json()

      if (!response.ok) {
        const message = json.error || "Failed to save business profile"
        setError(message)
        toast.showToast(message, "error")
        return
      }

      toast.showToast("Business profile updated", "success")
      setSuccess("Business profile updated.")

      if (returnPath) {
        setTimeout(() => router.push(returnPath), 600)
      }
    } catch (err: any) {
      setError(err.message || "Failed to save business profile")
      toast.showToast("Failed to save profile", "error")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6">Loading...</div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <button onClick={() => router.back()} className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white mb-3">
          Back
        </button>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Business Profile</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">Manage profile details for your business.</p>
      </div>

      {error && <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded">{error}</div>}
      {success && <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-400 text-green-700 dark:text-green-400 px-4 py-3 rounded">{success}</div>}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Business Logo</h2>
          {logoPreview && <img src={logoPreview} alt="Business logo" className="w-24 h-24 object-contain border rounded mb-3" />}
          <input type="file" accept="image/*" onChange={handleLogoUpload} className="text-gray-900 dark:text-white" />
        </div>

        {/* Business Identity */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Business Identity</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input value={formData.legal_name} onChange={(e) => handleChange("legal_name", e.target.value)} placeholder="Legal name" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 dark:bg-gray-700 dark:text-white" />
            <input value={formData.trading_name} onChange={(e) => handleChange("trading_name", e.target.value)} placeholder="Trading name" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 dark:bg-gray-700 dark:text-white" />
            <input value={formData.tin} onChange={(e) => handleChange("tin", e.target.value)} placeholder="TIN / Tax ID" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 dark:bg-gray-700 dark:text-white" />
            <input value={businessIndustry} readOnly disabled placeholder="Industry" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-gray-100 dark:bg-gray-700 dark:text-gray-300" />
            <DateInput value={formData.start_date} onChange={(e) => handleChange("start_date", e.target.value)} placeholder="Business start date" />
          </div>
        </div>

        {/* Location */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Location</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <select value={formData.address_country} onChange={(e) => handleChange("address_country", e.target.value)} className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 dark:bg-gray-700 dark:text-white">
              <option value="">Select country</option>
              <option value="Ghana">Ghana</option>
              <option value="Nigeria">Nigeria</option>
              <option value="Kenya">Kenya</option>
              <option value="South Africa">South Africa</option>
              <option value="Uganda">Uganda</option>
              <option value="Tanzania">Tanzania</option>
              <option value="United States">United States</option>
              <option value="United Kingdom">United Kingdom</option>
              <option value="Germany">Germany</option>
              <option value="France">France</option>
              <option value="Other">Other</option>
            </select>
            <input value={formData.address_region} onChange={(e) => handleChange("address_region", e.target.value)} placeholder="Region / State" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 dark:bg-gray-700 dark:text-white" />
            <input value={formData.address_city} onChange={(e) => handleChange("address_city", e.target.value)} placeholder="City" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 dark:bg-gray-700 dark:text-white" />
            <input value={formData.address_street} onChange={(e) => handleChange("address_street", e.target.value)} placeholder="Street address" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 dark:bg-gray-700 dark:text-white" />
          </div>
        </div>

        {/* Contact */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Contact</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input value={formData.phone} onChange={(e) => handleChange("phone", e.target.value)} placeholder="Phone" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 dark:bg-gray-700 dark:text-white" />
            <input value={formData.whatsapp_phone} onChange={(e) => handleChange("whatsapp_phone", e.target.value)} placeholder="WhatsApp number" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 dark:bg-gray-700 dark:text-white" />
            <input type="email" value={formData.email} onChange={(e) => handleChange("email", e.target.value)} placeholder="Email" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 dark:bg-gray-700 dark:text-white" />
            <input value={formData.website} onChange={(e) => handleChange("website", e.target.value)} placeholder="Website" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 dark:bg-gray-700 dark:text-white" />
          </div>
        </div>

        {/* Financial Settings */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Financial Settings</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Required to create invoices and generate reports.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <select value={formData.default_currency} onChange={(e) => handleChange("default_currency", e.target.value)} className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 dark:bg-gray-700 dark:text-white">
              <option value="">Select currency</option>
              <option value="GHS">GHS — Ghana Cedi (₵)</option>
              <option value="NGN">NGN — Nigerian Naira (₦)</option>
              <option value="KES">KES — Kenyan Shilling (KSh)</option>
              <option value="ZAR">ZAR — South African Rand (R)</option>
              <option value="UGX">UGX — Ugandan Shilling (USh)</option>
              <option value="TZS">TZS — Tanzanian Shilling (TSh)</option>
              <option value="USD">USD — US Dollar ($)</option>
              <option value="GBP">GBP — British Pound (£)</option>
              <option value="EUR">EUR — Euro (€)</option>
            </select>
          </div>
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 dark:bg-gray-700">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">
            {saving ? "Saving..." : "Save Business Profile"}
          </button>
        </div>
      </form>
    </div>
  )
}
