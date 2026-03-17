"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import DateInput from "@/components/ui/DateInput"

const COUNTRY_CURRENCY_MAP: Record<string, string> = {
  Ghana: "GHS",
  Nigeria: "NGN",
  Kenya: "KES",
  "South Africa": "ZAR",
  Uganda: "UGX",
  Tanzania: "TZS",
  "United States": "USD",
  "United Kingdom": "GBP",
  Germany: "EUR",
  France: "EUR",
  Other: "USD",
}

const COUNTRIES = [
  "Ghana",
  "Nigeria",
  "Kenya",
  "South Africa",
  "Uganda",
  "Tanzania",
  "United States",
  "United Kingdom",
  "Germany",
  "France",
  "Other",
]

const inputClass =
  "w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"

const labelClass = "block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5"

export default function BusinessSetupPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [industry, setIndustry] = useState("")
  const [country, setCountry] = useState("")
  const [currency, setCurrency] = useState("")
  const [startDate, setStartDate] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    loadUser()
  }, [])

  const loadUser = async () => {
    const { data: authData } = await supabase.auth.getUser()
    if (authData.user) {
      setUser(authData.user)
    }
  }

  const handleCountryChange = (selectedCountry: string) => {
    setCountry(selectedCountry)
    const autoCurrency = COUNTRY_CURRENCY_MAP[selectedCountry] || ""
    setCurrency(autoCurrency)
  }

  const ensureUserRecord = async (authUser: any) => {
    const { data: existingUser } = await supabase
      .from("users")
      .select("*")
      .eq("id", authUser.id)
      .maybeSingle()

    if (existingUser) {
      return existingUser
    }

    const { data: newUser, error: newUserError } = await supabase
      .from("users")
      .insert({
        id: authUser.id,
        email: authUser.email,
        full_name: authUser.user_metadata?.full_name || "",
      })
      .select()
      .single()

    if (newUserError) {
      throw newUserError
    }

    return newUser
  }

  const handleSave = async () => {
    setError("")
    setSaving(true)

    let currentUser = user
    if (!currentUser) {
      const { data: authData } = await supabase.auth.getUser()
      if (!authData.user) {
        setError("Not logged in")
        setSaving(false)
        return
      }
      currentUser = authData.user
    }

    let userRecord
    try {
      userRecord = await ensureUserRecord(currentUser)
    } catch (err: any) {
      setError(err.message || "Failed to prepare user record")
      setSaving(false)
      return
    }

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .insert({
        owner_id: userRecord.id,
        name,
        industry,
        address_country: country || null,
        default_currency: currency || null,
        start_date: startDate || null,
        onboarding_step: "business_profile",
      })
      .select("id, name, industry, created_at, start_date, onboarding_step")
      .single()

    if (businessError) {
      setError(businessError.message)
      setSaving(false)
      return
    }

    const { error: userError } = await supabase.from("business_users").insert({
      business_id: business.id,
      user_id: userRecord.id,
      role: "admin",
    })

    if (userError) {
      setError(userError.message)
      setSaving(false)
      return
    }

    router.push("/onboarding")
  }

  const canSubmit = name.trim() && industry && country && currency && !saving

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-100 dark:bg-blue-900/30 rounded-2xl mb-4">
              <svg className="w-7 h-7 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Set up your business</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">Tell us about your business to get started</p>
          </div>

          {/* Card */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 p-8 space-y-5">

            {/* Error */}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded-r text-sm flex items-start gap-2">
                <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            {/* Business Name */}
            <div>
              <label className={labelClass}>Business name <span className="text-red-500">*</span></label>
              <input
                className={inputClass}
                placeholder="e.g. Kofi's Auto Repairs"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Business Type */}
            <div>
              <label className={labelClass}>Business type <span className="text-red-500">*</span></label>
              <select
                className={inputClass}
                onChange={(e) => setIndustry(e.target.value)}
                value={industry}
              >
                <option value="">Choose a type…</option>
                <option value="retail">Retail Shop</option>
                <option value="service">General Service</option>
                <option value="logistics">Logistics / Delivery</option>
              </select>
            </div>

            {/* Country */}
            <div>
              <label className={labelClass}>Country <span className="text-red-500">*</span></label>
              <select
                className={inputClass}
                onChange={(e) => handleCountryChange(e.target.value)}
                value={country}
              >
                <option value="">Select country…</option>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Currency */}
            <div>
              <label className={labelClass}>Default currency <span className="text-red-500">*</span></label>
              <select
                className={inputClass}
                onChange={(e) => setCurrency(e.target.value)}
                value={currency}
              >
                <option value="">Select currency…</option>
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
              {country && currency && (
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  Auto-selected based on your country. You can change this anytime in settings.
                </p>
              )}
            </div>

            {/* Start Date */}
            <div>
              <label className={labelClass}>Business start date <span className="text-gray-400 font-normal">(optional)</span></label>
              <DateInput
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                placeholder="When did you start trading?"
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSave}
              disabled={!canSubmit}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-150 flex items-center justify-center gap-2 mt-2"
            >
              {saving ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Setting up…
                </>
              ) : (
                <>
                  Continue
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </>
              )}
            </button>
          </div>

          <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-6">
            You can update all of this later in Business Profile settings.
          </p>
        </div>
      </div>
    </ProtectedLayout>
  )
}
