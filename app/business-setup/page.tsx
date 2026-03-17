"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"

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

export default function BusinessSetupPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [industry, setIndustry] = useState("")
  const [country, setCountry] = useState("")
  const [currency, setCurrency] = useState("")
  const [startDate, setStartDate] = useState("")
  const [error, setError] = useState("")
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

    let currentUser = user
    if (!currentUser) {
      const { data: authData } = await supabase.auth.getUser()
      if (!authData.user) {
        setError("Not logged in")
        return
      }
      currentUser = authData.user
    }

    let userRecord
    try {
      userRecord = await ensureUserRecord(currentUser)
    } catch (err: any) {
      setError(err.message || "Failed to prepare user record")
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
      return
    }

    const { error: userError } = await supabase.from("business_users").insert({
      business_id: business.id,
      user_id: userRecord.id,
      role: "admin",
    })

    if (userError) {
      setError(userError.message)
      return
    }

    router.push("/onboarding")
  }

  return (
    <ProtectedLayout>
      <div className="flex items-center justify-center h-screen">
        <div className="w-96">
          <h1 className="text-2xl font-bold mb-4">Set up your business</h1>

          {error && <p className="text-red-500 mb-2">{error}</p>}

          <input
            className="border p-2 w-full mb-3"
            placeholder="Business name"
            onChange={(e) => setName(e.target.value)}
          />

          <select
            className="border p-2 w-full mb-3"
            onChange={(e) => setIndustry(e.target.value)}
            value={industry}
          >
            <option value="">Choose business type</option>
            <option value="retail">Retail Shop</option>
            <option value="service">General Service</option>
            <option value="logistics">Logistics / Delivery</option>
          </select>

          <select
            className="border p-2 w-full mb-3"
            onChange={(e) => handleCountryChange(e.target.value)}
            value={country}
          >
            <option value="">Select country</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            className="border p-2 w-full mb-3"
            onChange={(e) => setCurrency(e.target.value)}
            value={currency}
          >
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

          <input
            type="date"
            className="border p-2 w-full mb-4"
            placeholder="Business start date (optional)"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />

          <button
            onClick={handleSave}
            className="bg-green-600 text-white p-2 w-full"
            disabled={!name || !industry || !country || !currency}
          >
            Continue
          </button>
        </div>
      </div>
    </ProtectedLayout>
  )
}
