"use client"

import { useEffect, useMemo, useState, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { useToast } from "@/components/ui/ToastProvider"
import BusinessLogoDisplay from "@/components/BusinessLogoDisplay"
import { dispatchBusinessBrandingUpdated } from "@/lib/business/businessBrandingEvents"
import { tryBusinessAssetsLogoStoragePath } from "@/lib/business/businessLogoStorage"
import { retailPaths } from "@/lib/retail/routes"
import { normalizeRetailReturnUrl } from "@/lib/retail/normalizeRetailReturnUrl"
import { getUserRole } from "@/lib/userRoles"
import { canEditBusinessWideSensitiveSettings } from "@/lib/retail/retailSensitiveSettingsEditors"
import { retailSettingsShell as RS } from "@/lib/retail/retailSettingsShell"
import { retailFieldClass, retailLabelClass } from "@/components/retail/RetailBackofficeUi"

export default function RetailBusinessProfilePage() {
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
  const safeReturn = useMemo(
    () => normalizeRetailReturnUrl(returnPath, retailPaths.dashboard),
    [returnPath],
  )

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
  const [selectedLogoFileName, setSelectedLogoFileName] = useState<string | null>(null)
  const [logoActionLoading, setLogoActionLoading] = useState(false)
  const logoFileInputRef = useRef<HTMLInputElement>(null)
  const [canEditProfile, setCanEditProfile] = useState(false)

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

      if (business.industry !== "retail") {
        router.push(retailPaths.dashboard)
        return
      }

      setBusinessId(business.id)

      const role = await getUserRole(supabase, user.id, business.id)
      setCanEditProfile(canEditBusinessWideSensitiveSettings(role))

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

    if (!canEditProfile) {
      const message = "Only owners and admins can update the business profile."
      toast.showToast(message, "error")
      setError(message)
      return
    }

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
    if (!businessId || logoActionLoading || !canEditProfile) return

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
        if (rmErr) console.warn("[retail business-profile] logo storage remove:", rmErr.message)
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
    canEditProfile &&
    (Boolean(formData.logo_url?.trim()) ||
      Boolean(logoPreview?.startsWith("blob:")) ||
      Boolean(logoPreview && /^https?:\/\//i.test(logoPreview)))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSuccess("")

    if (!canEditProfile) {
      const message = "Only owners and admins can update the business profile."
      setError(message)
      toast.showToast(message, "error")
      return
    }

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
        credentials: "include",
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
        setTimeout(() => router.push(safeReturn), 600)
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
      <div className={RS.container}>
        <div className={RS.loadingCenter}>
          <div
            className="h-9 w-9 animate-spin rounded-full border-2 border-gray-200 border-t-blue-600 dark:border-gray-700 dark:border-t-blue-500"
            aria-hidden
          />
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">Loading profile…</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`${RS.container} max-w-4xl space-y-6`}>
      <div>
        <button type="button" onClick={() => router.push(safeReturn)} className={`${RS.backLink} mb-2 block text-left`}>
          ← Back
        </button>
        <h1 className={RS.pageTitle}>Business profile</h1>
        <p className={RS.subtitle}>Legal and contact details used across Retail (receipts, statements, and admin).</p>
      </div>

      {error ? <div className={RS.alertError}>{error}</div> : null}
      {success ? <div className={RS.alertSuccess}>{success}</div> : null}

      {!canEditProfile ? (
        <div className={RS.alertWarning}>View only. Only owners and admins can change this profile.</div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-6">
        <fieldset disabled={!canEditProfile} className="m-0 min-w-0 space-y-6 border-0 p-0">
          <div className={RS.formSectionCard}>
            <h2 className={`${RS.sectionTitle} mb-1`}>Logo</h2>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">PNG, JPG, or WebP, up to 2 MB.</p>
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
                id="business-logo"
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={logoActionLoading}
                onChange={handleLogoUpload}
              />
              <label
                htmlFor="business-logo"
                className={`inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 ${logoActionLoading ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
              >
                {logoActionLoading ? "Uploading…" : "Choose image"}
              </label>
              {selectedLogoFileName ? (
                <span className="text-sm text-gray-600 dark:text-gray-400 truncate max-w-[12rem] sm:max-w-xs" title={selectedLogoFileName}>
                  Selected: {selectedLogoFileName}
                </span>
              ) : formData.logo_url?.trim() && !logoPreview?.startsWith("blob:") ? (
                <span className="text-sm text-gray-600 dark:text-gray-400">Current logo saved</span>
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

          <div className={`${RS.formSectionCard} grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-x-5 md:gap-y-4`}>
            <div className="md:col-span-2">
              <h2 className={RS.sectionTitle}>Business details</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Names and tax identifiers.</p>
            </div>
            <div>
              <label className={retailLabelClass} htmlFor="legal_name">
                Legal name
              </label>
              <input
                id="legal_name"
                value={formData.legal_name}
                onChange={(e) => setFormData({ ...formData, legal_name: e.target.value })}
                className={retailFieldClass}
                autoComplete="organization"
              />
            </div>
            <div>
              <label className={retailLabelClass} htmlFor="trading_name">
                Trading name
              </label>
              <input
                id="trading_name"
                value={formData.trading_name}
                onChange={(e) => setFormData({ ...formData, trading_name: e.target.value })}
                className={retailFieldClass}
              />
            </div>
            <div>
              <label className={retailLabelClass} htmlFor="tin">
                Tax ID (TIN)
              </label>
              <input id="tin" value={formData.tin} onChange={(e) => setFormData({ ...formData, tin: e.target.value })} className={retailFieldClass} />
            </div>
            <div>
              <label className={retailLabelClass} htmlFor="default_currency">
                Default currency <span className="text-red-600">*</span>
              </label>
              <input
                id="default_currency"
                value={formData.default_currency}
                onChange={(e) => setFormData({ ...formData, default_currency: e.target.value })}
                className={retailFieldClass}
                placeholder="e.g. GHS"
              />
            </div>
            <div>
              <label className={retailLabelClass} htmlFor="start_date">
                Start date
              </label>
              <input
                id="start_date"
                type="date"
                value={formData.start_date}
                onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                className={retailFieldClass}
              />
            </div>
            <div>
              <label className={retailLabelClass} htmlFor="industry">
                Industry
              </label>
              <input
                id="industry"
                value={businessIndustry}
                readOnly
                disabled
                className={`${retailFieldClass} cursor-not-allowed bg-gray-50 opacity-80 dark:bg-gray-900`}
              />
            </div>

            <div className="md:col-span-2 mt-2 border-t border-gray-100 pt-4 dark:border-gray-800">
              <h2 className={RS.sectionTitle}>Address</h2>
            </div>
            <div className="md:col-span-2">
              <label className={retailLabelClass} htmlFor="address_street">
                Street
              </label>
              <input
                id="address_street"
                value={formData.address_street}
                onChange={(e) => setFormData({ ...formData, address_street: e.target.value })}
                className={retailFieldClass}
              />
            </div>
            <div>
              <label className={retailLabelClass} htmlFor="address_city">
                City
              </label>
              <input id="address_city" value={formData.address_city} onChange={(e) => setFormData({ ...formData, address_city: e.target.value })} className={retailFieldClass} />
            </div>
            <div>
              <label className={retailLabelClass} htmlFor="address_region">
                Region / state
              </label>
              <input id="address_region" value={formData.address_region} onChange={(e) => setFormData({ ...formData, address_region: e.target.value })} className={retailFieldClass} />
            </div>
            <div className="md:col-span-2">
              <label className={retailLabelClass} htmlFor="address_country">
                Country <span className="text-red-600">*</span>
              </label>
              <input
                id="address_country"
                value={formData.address_country}
                onChange={(e) => setFormData({ ...formData, address_country: e.target.value })}
                className={retailFieldClass}
              />
            </div>

            <div className="md:col-span-2 mt-2 border-t border-gray-100 pt-4 dark:border-gray-800">
              <h2 className={RS.sectionTitle}>Contact</h2>
            </div>
            <div>
              <label className={retailLabelClass} htmlFor="phone">
                Phone
              </label>
              <input id="phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className={retailFieldClass} type="tel" />
            </div>
            <div>
              <label className={retailLabelClass} htmlFor="whatsapp_phone">
                WhatsApp
              </label>
              <input id="whatsapp_phone" value={formData.whatsapp_phone} onChange={(e) => setFormData({ ...formData, whatsapp_phone: e.target.value })} className={retailFieldClass} type="tel" />
            </div>
            <div>
              <label className={retailLabelClass} htmlFor="email">
                Email
              </label>
              <input id="email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className={retailFieldClass} />
            </div>
            <div className="md:col-span-2">
              <label className={retailLabelClass} htmlFor="website">
                Website
              </label>
              <input id="website" value={formData.website} onChange={(e) => setFormData({ ...formData, website: e.target.value })} className={retailFieldClass} type="url" />
            </div>
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => router.push(safeReturn)} className={RS.secondaryButton}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !canEditProfile}
            title={!canEditProfile ? "Only owners and admins can save" : undefined}
            className={RS.primaryButton}
          >
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    </div>
  )
}

