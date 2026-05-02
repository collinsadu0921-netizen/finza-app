"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { useToast } from "@/components/ui/ToastProvider"
import DateInput from "@/components/ui/DateInput"
import { NativeSelect } from "@/components/ui/NativeSelect"
import BusinessLogoDisplay from "@/components/BusinessLogoDisplay"
import { dispatchBusinessBrandingUpdated } from "@/lib/business/businessBrandingEvents"
import { tryBusinessAssetsLogoStoragePath } from "@/lib/business/businessLogoStorage"

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
    cit_rate_code: "standard_25",
    vat_scheme: "standard",
    business_type: "limited_company",
  })

  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [selectedLogoFileName, setSelectedLogoFileName] = useState<string | null>(null)
  const [logoActionLoading, setLogoActionLoading] = useState(false)
  const logoFileInputRef = useRef<HTMLInputElement>(null)

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
        cit_rate_code: businessData.cit_rate_code || "standard_25",
        vat_scheme: businessData.vat_scheme || "standard",
        business_type: businessData.business_type || "limited_company",
      })

      setLogoPreview(businessData.logo_url?.trim() ? businessData.logo_url : null)
      setSelectedLogoFileName(null)
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

    const restoreLogoPreview = formData.logo_url?.trim() ? formData.logo_url : null

    const allowedTypes = ["image/png", "image/jpeg", "image/webp"]
    if (!allowedTypes.includes(file.type) || file.size > 2 * 1024 * 1024) {
      const message = "Logo must be PNG, JPG, or WebP under 2MB"
      toast.showToast(message, "error")
      setError(message)
      e.target.value = ""
      setSelectedLogoFileName(null)
      return
    }

    setSelectedLogoFileName(file.name)
    const previewUrl = URL.createObjectURL(file)
    setLogoPreview(previewUrl)
    setLogoActionLoading(true)
    setError("")

    try {
      const fileExt = file.name.split(".").pop()?.toLowerCase() || "png"
      const filePath = `business-logos/${businessId}/${Date.now()}.${fileExt}`

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("business-assets")
        .upload(filePath, file, { cacheControl: "3600", contentType: file.type, upsert: false })

      if (uploadError || !uploadData) throw new Error("Logo upload failed")

      const {
        data: { publicUrl },
      } = supabase.storage.from("business-assets").getPublicUrl(filePath)

      const profileRes = await fetch("/api/business/profile", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, logo_url: publicUrl }),
      })
      const profileJson = await profileRes.json().catch(() => ({}))
      if (!profileRes.ok) {
        throw new Error((profileJson as { error?: string }).error || "Failed to save logo on profile")
      }

      URL.revokeObjectURL(previewUrl)
      setFormData((prev) => ({ ...prev, logo_url: publicUrl }))
      setLogoPreview(publicUrl)
      setSelectedLogoFileName(null)
      if (logoFileInputRef.current) logoFileInputRef.current.value = ""
      dispatchBusinessBrandingUpdated({ businessId, logo_url: publicUrl })
      setSuccess("Logo uploaded successfully!")
      toast.showToast("Logo uploaded successfully!", "success")
    } catch {
      URL.revokeObjectURL(previewUrl)
      setLogoPreview(restoreLogoPreview)
      setSelectedLogoFileName(null)
      if (logoFileInputRef.current) logoFileInputRef.current.value = ""
      setError("Logo upload failed. Please try again.")
      toast.showToast("Logo upload failed. Please try again.", "error")
    } finally {
      setLogoActionLoading(false)
    }
  }

  const handleRemoveLogo = async () => {
    if (!businessId || logoActionLoading) return

    const hadStoredUrl = Boolean(formData.logo_url?.trim())
    const prevPublicUrl = formData.logo_url.trim()

    if (!hadStoredUrl && logoPreview?.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(logoPreview)
      } catch {
        /* noop */
      }
      setLogoPreview(null)
      setSelectedLogoFileName(null)
      if (logoFileInputRef.current) logoFileInputRef.current.value = ""
      return
    }

    setLogoActionLoading(true)
    setError("")
    try {
      const profileRes = await fetch("/api/business/profile", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, logo_url: null }),
      })
      const profileJson = await profileRes.json().catch(() => ({}))
      if (!profileRes.ok) {
        throw new Error((profileJson as { error?: string }).error || "Failed to remove logo")
      }

      const storagePath = tryBusinessAssetsLogoStoragePath(prevPublicUrl, businessId)
      if (storagePath) {
        const { error: rmErr } = await supabase.storage.from("business-assets").remove([storagePath])
        if (rmErr) console.warn("[business-profile] logo storage remove:", rmErr.message)
      }

      setFormData((prev) => ({ ...prev, logo_url: "" }))
      setLogoPreview(null)
      setSelectedLogoFileName(null)
      if (logoFileInputRef.current) logoFileInputRef.current.value = ""
      dispatchBusinessBrandingUpdated({ businessId, logo_url: null })
      setSuccess("Logo removed.")
      toast.showToast("Logo removed", "success")
    } catch (err: any) {
      const message = err?.message || "Failed to remove logo"
      setError(message)
      toast.showToast(message, "error")
    } finally {
      setLogoActionLoading(false)
    }
  }

  const showRemoveLogo =
    Boolean(formData.logo_url?.trim()) ||
    Boolean(logoPreview?.startsWith("blob:")) ||
    Boolean(logoPreview && /^https?:\/\//i.test(logoPreview))

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
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            PNG, JPG, or WebP, up to 2 MB. Shown in the sidebar and on documents that use your business branding.
          </p>
          <div className="mb-4 inline-flex max-w-full rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-600">
            <BusinessLogoDisplay
              logoUrl={logoPreview}
              businessName={formData.trading_name || formData.legal_name}
              variant="document"
              size="xl"
              rounded="lg"
              brandingResolved={!loading}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={logoFileInputRef}
              id="service-business-logo"
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={logoActionLoading}
              onChange={handleLogoUpload}
            />
            <label
              htmlFor="service-business-logo"
              className={`inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 ${logoActionLoading ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
            >
              {logoActionLoading ? "Uploading…" : "Choose image"}
            </label>
            {selectedLogoFileName ? (
              <span className="text-sm text-gray-600 dark:text-gray-400 truncate max-w-[12rem] sm:max-w-xs" title={selectedLogoFileName}>
                Selected: {selectedLogoFileName}
              </span>
            ) : formData.logo_url?.trim() && !logoPreview?.startsWith("blob:") ? (
              <span className="text-sm text-gray-600 dark:text-gray-400 truncate max-w-[12rem] sm:max-w-xs" title={formData.logo_url}>
                Current logo URL saved
              </span>
            ) : null}
            {showRemoveLogo ? (
              <button
                type="button"
                onClick={handleRemoveLogo}
                disabled={logoActionLoading}
                className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 shadow-sm transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                Remove logo
              </button>
            ) : null}
          </div>
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
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Legal Entity Type
              </label>
              <NativeSelect
                value={formData.business_type}
                onChange={(e) => handleChange("business_type", e.target.value)}
                wrapperClassName="w-full md:w-1/2"
              >
                <option value="limited_company">Limited Company</option>
                <option value="sole_proprietorship">Sole Proprietorship</option>
              </NativeSelect>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Used to format your Annual Financial Statements correctly (equity section structure).
              </p>
            </div>
          </div>
        </div>

        {/* Location */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Location</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NativeSelect value={formData.address_country} onChange={(e) => handleChange("address_country", e.target.value)}>
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
            </NativeSelect>
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
            <NativeSelect value={formData.default_currency} onChange={(e) => handleChange("default_currency", e.target.value)}>
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
            </NativeSelect>
          </div>
        </div>

        {/* Tax Settings — Ghana only */}
        {formData.address_country === "Ghana" && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Tax Settings</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Used to automatically calculate your Corporate Income Tax (CIT) provisions.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                CIT Rate Category
              </label>
              <NativeSelect
                value={formData.cit_rate_code}
                onChange={(e) => handleChange("cit_rate_code", e.target.value)}
                wrapperClassName="w-full md:w-1/2"
              >
                <option value="standard_25">Standard Company — 25% of net profit</option>
                <option value="hotel_22">Hotel Industry — 22% of net profit</option>
                <option value="bank_20">Bank / Financial (agri & leasing income) — 20%</option>
                <option value="export_8">Non-Traditional Exports — 8% of net profit</option>
                <option value="agro_1">Agro-processing (first 5 yrs) — 1% of net profit</option>
                <option value="mining_35">Mining / Upstream Petroleum — 35% of net profit</option>
                <option value="presumptive_3">Presumptive / Sole Trader — 3% of gross turnover</option>
                <option value="exempt">Exempt (Free Zone / Tax Holiday) — 0%</option>
              </NativeSelect>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                Not sure? Most registered companies use <strong>Standard — 25%</strong>. Consult your accountant if you qualify for a reduced rate.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                VAT Registration Status
              </label>
              <NativeSelect
                value={formData.vat_scheme}
                onChange={(e) => handleChange("vat_scheme", e.target.value)}
                wrapperClassName="w-full md:w-1/2"
              >
                <option value="standard">VAT Registered — Standard Rate (15% + NHIL + GETFund)</option>
                <option value="none">Not VAT Registered — turnover below GHS 750,000</option>
              </NativeSelect>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                If you have a VAT certificate from GRA, select <strong>VAT Registered</strong>. Businesses with annual turnover below GHS 750,000 are not required to register (VAT Act 2025, Act 1151). The VAT Flat Rate Scheme (VFRS) was abolished effective January 1, 2026.
              </p>
            </div>
          </div>
        )}

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
