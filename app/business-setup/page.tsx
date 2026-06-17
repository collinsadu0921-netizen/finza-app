"use client"

import { Suspense, useState, useEffect, useMemo } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter, useSearchParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import DateInput from "@/components/ui/DateInput"
import { setSelectedBusinessId } from "@/lib/business"
import { SIGNUP_GOALS, SIGNUP_GOAL_LABELS, type SignupGoal } from "@/lib/growth/signupGoals"
import {
  mergeSignupAttribution,
  parseSignupAttributionFromSearchParams,
  persistSignupAttributionToSession,
  readSignupAttributionFromSession,
  type SignupAttribution,
} from "@/lib/growth/signupAttribution"

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
  Other: "GHS",
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

const ORPHAN_PUBLIC_USER_EMAIL_MESSAGE =
  "A Finza profile already exists for this email from a previous deleted login. Please use another test email or ask an admin to clean up the orphan profile."

function isPublicUsersEmailUniqueViolation(err: unknown): boolean {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: string }).code ?? "")
      : ""
  const message =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message?: string }).message ?? "")
      : err instanceof Error
        ? err.message
        : String(err ?? "")
  if (code === "23505") return true
  if (message.includes("users_email_key")) return true
  return false
}

export default function BusinessSetupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">Loading…</div>
      }
    >
      <BusinessSetupPageInner />
    </Suspense>
  )
}

function BusinessSetupPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [name, setName] = useState("")
  const [country, setCountry] = useState("")
  const [city, setCity] = useState("")
  const [currency, setCurrency] = useState("")
  const [startDate, setStartDate] = useState("")
  const [phoneOrWhatsapp, setPhoneOrWhatsapp] = useState("")
  const [signupGoal, setSignupGoal] = useState<SignupGoal>("send_invoices")
  const [referralSource, setReferralSource] = useState("")
  const [contactConsent, setContactConsent] = useState(false)
  const [attribution, setAttribution] = useState<SignupAttribution>({
    signup_source: null,
    signup_utm_source: null,
    signup_utm_medium: null,
    signup_utm_campaign: null,
  })
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    void loadUser()
    const fromUrl = parseSignupAttributionFromSearchParams(searchParams)
    const fromSession = readSignupAttributionFromSession()
    const merged = mergeSignupAttribution(fromSession ?? fromUrl, fromUrl)
    setAttribution(merged)
    persistSignupAttributionToSession(merged)
    if (merged.signup_source && !referralSource) {
      setReferralSource(merged.signup_source)
    }
  }, [searchParams])

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
    const { data: existingUser } = await supabase.from("users").select("*").eq("id", authUser.id).maybeSingle()

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

    if (!contactConsent) {
      setError("Please agree to Finza contacting you about onboarding, your trial, and account support.")
      setSaving(false)
      return
    }

    try {
      await ensureUserRecord(currentUser)
    } catch (err: unknown) {
      if (isPublicUsersEmailUniqueViolation(err)) {
        setError(ORPHAN_PUBLIC_USER_EMAIL_MESSAGE)
      } else {
        const msg =
          err instanceof Error ? err.message : typeof err === "object" && err !== null && "message" in err
            ? String((err as { message?: string }).message)
            : "Failed to prepare user record"
        setError(msg || "Failed to prepare user record")
      }
      setSaving(false)
      return
    }

    const sourceTrimmed = referralSource.trim() || attribution.signup_source

    try {
      const res = await fetch("/api/auth/provision-service-business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          address_country: country || null,
          address_city: city.trim() || null,
          default_currency: currency,
          start_date: startDate || null,
          phone_or_whatsapp: phoneOrWhatsapp.trim(),
          signup_goal: signupGoal,
          signup_source: sourceTrimmed || null,
          signup_utm_source: attribution.signup_utm_source,
          signup_utm_medium: attribution.signup_utm_medium,
          signup_utm_campaign: attribution.signup_utm_campaign,
          trial_contact_consent: true,
        }),
      })

      const payload = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(payload.error || "Could not create your business")
        setSaving(false)
        return
      }

      const business = payload.business
      if (business?.id) {
        setSelectedBusinessId(business.id)
      }

      setSaving(false)

      if (payload.alreadyExists && business) {
        const step = business.onboarding_step as string | undefined
        if (step && step !== "complete") {
          router.push("/onboarding")
        } else {
          router.push("/service/dashboard")
        }
        return
      }

      router.push("/onboarding")
    } catch (err: any) {
      setError(err.message || "Something went wrong")
      setSaving(false)
    }
  }

  const canSubmit = useMemo(
    () =>
      name.trim() &&
      country &&
      currency &&
      phoneOrWhatsapp.trim().length >= 8 &&
      signupGoal &&
      contactConsent &&
      !saving,
    [name, country, currency, phoneOrWhatsapp, signupGoal, contactConsent, saving]
  )

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-100 dark:bg-blue-900/30 rounded-2xl mb-4">
              <svg className="w-7 h-7 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Set up your business</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Finza Service — tell us about your business so we can tailor your trial and onboarding.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 p-8 space-y-5">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded-r text-sm flex items-start gap-2">
                {error}
              </div>
            )}

            <div>
              <label className={labelClass}>
                Business name <span className="text-red-500">*</span>
              </label>
              <input
                className={inputClass}
                placeholder="e.g. Kofi's Auto Repairs"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <label className={labelClass}>
                Phone or WhatsApp <span className="text-red-500">*</span>
              </label>
              <input
                className={inputClass}
                placeholder="e.g. 024 123 4567"
                value={phoneOrWhatsapp}
                onChange={(e) => setPhoneOrWhatsapp(e.target.value)}
                inputMode="tel"
                autoComplete="tel"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Used for account support and trial onboarding — not sold to third parties.
              </p>
            </div>

            <div>
              <label className={labelClass}>
                What do you want to do first? <span className="text-red-500">*</span>
              </label>
              <select
                className={inputClass}
                value={signupGoal}
                onChange={(e) => setSignupGoal(e.target.value as SignupGoal)}
              >
                {SIGNUP_GOALS.map((g) => (
                  <option key={g} value={g}>
                    {SIGNUP_GOAL_LABELS[g]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>
                Country <span className="text-red-500">*</span>
              </label>
              <select className={inputClass} onChange={(e) => handleCountryChange(e.target.value)} value={country}>
                <option value="">Select country…</option>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>
                City <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                className={inputClass}
                placeholder="e.g. Accra"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>

            <div>
              <label className={labelClass}>
                Default currency <span className="text-red-500">*</span>
              </label>
              <select className={inputClass} onChange={(e) => setCurrency(e.target.value)} value={currency}>
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
            </div>

            <div>
              <label className={labelClass}>
                How did you hear about us? <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                className={inputClass}
                placeholder="e.g. friend, Instagram, Google"
                value={referralSource}
                onChange={(e) => setReferralSource(e.target.value)}
              />
            </div>

            <div>
              <label className={labelClass}>
                Business start date <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <DateInput
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                placeholder="When did you start trading?"
              />
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={contactConsent}
                onChange={(e) => setContactConsent(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600 dark:text-gray-400 leading-snug">
                I agree that Finza may contact me about onboarding, my trial, and account support.
              </span>
            </label>

            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canSubmit}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-150 flex items-center justify-center gap-2 mt-2"
            >
              {saving ? "Setting up…" : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
