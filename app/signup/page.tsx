"use client"

import { Suspense, useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter, useSearchParams } from "next/navigation"
import {
  parseServiceSubscriptionTier,
  tryParseServiceSubscriptionTier,
} from "@/lib/serviceWorkspace/subscriptionTiers"
import { FinzaLogo } from "@/components/FinzaLogo"
import { FinzaDemoVideoEmbed } from "@/components/marketing/FinzaDemoVideoEmbed"

/**
 * Valid workspaces that support the trial flow.
 * Only "service" is finished — do NOT extend to retail or other workspaces.
 */
const TRIAL_SUPPORTED_WORKSPACES = ["service"] as const

/**
 * Strict signup gate.
 *
 * When NEXT_PUBLIC_SIGNUP_REQUIRE_SERVICE_PLAN_CONTEXT === "true", the signup
 * page is only accessible if the visitor arrives with:
 *   (a) valid service plan context:  workspace=service & plan=<valid tier>
 *   (b) accounting-firm bypass:      flow=accounting_firm
 *
 * Any other visitor is redirected to NEXT_PUBLIC_MARKETING_PRICING_URL.
 * When the flag is absent / not "true" the gate is OFF and behavior is
 * identical to before — nothing changes for dev or existing flows.
 */
const STRICT_GATE =
  process.env.NEXT_PUBLIC_SIGNUP_REQUIRE_SERVICE_PLAN_CONTEXT === "true"

/**
 * Strict plan validator used ONLY by the signup gate.
 *
 * Intentionally does NOT fall back to "starter" — an unknown or missing plan
 * param should fail the gate, not silently grant entry as Essentials.
 * This is separate from parseServiceSubscriptionTier (which has a safe
 * fallback for subscription logic elsewhere).
 */
function isValidServicePlanParam(raw: string): boolean {
  const n = raw.trim().toLowerCase()
  // Mirror all aliases accepted by parseServiceSubscriptionTier so the gate
  // stays in sync with the rest of the tier system.
  return (
    n === "starter"      || n === "essentials" ||
    n === "professional" || n === "growth"     || n === "pro" ||
    n === "business"     || n === "scale"       || n === "enterprise"
  )
}

function SignupPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // --- Trial intent from marketing site URL params ---
  // e.g. /signup?workspace=service&plan=professional&trial=1
  // These are read once on mount; stored durably in user metadata so they
  // survive email verification redirects (URL params are lost after the flow).
  const rawWorkspace = searchParams.get("workspace") ?? ""
  const rawPlan      = searchParams.get("plan") ?? ""
  const rawTrial     = searchParams.get("trial") ?? ""

  // Accounting-firm bypass param (flow=accounting_firm).
  // Used by: accounting firm invite links, internal onboarding.
  const rawFlow = searchParams.get("flow") ?? ""
  const isAccountingFirmFlow = rawFlow === "accounting_firm"

  const hasValidServicePlanContext =
    rawWorkspace.trim().toLowerCase() === "service" &&
    tryParseServiceSubscriptionTier(rawPlan) !== null

  const shouldBlockAndRedirect =
    STRICT_GATE && !hasValidServicePlanContext && !isAccountingFirmFlow

  useEffect(() => {
    if (!shouldBlockAndRedirect) return
    const pricingUrl = process.env.NEXT_PUBLIC_MARKETING_PRICING_URL?.trim()
    if (pricingUrl) {
      window.location.replace(pricingUrl)
      return
    }
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[signup] NEXT_PUBLIC_SIGNUP_REQUIRE_SERVICE_PLAN_CONTEXT is true but NEXT_PUBLIC_MARKETING_PRICING_URL is empty; falling back to /"
      )
    }
    window.location.replace("/")
  }, [shouldBlockAndRedirect])

  // Only honour trial intent for finished workspaces
  const trialWorkspace = (TRIAL_SUPPORTED_WORKSPACES as readonly string[]).includes(rawWorkspace)
    ? rawWorkspace
    : null
  // Normalise plan alias → internal tier key
  const trialPlan = trialWorkspace
    ? parseServiceSubscriptionTier(rawPlan) // returns 'starter' if invalid → safe fallback
    : null
  const hasTrial = trialWorkspace !== null && rawTrial === "1"

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [fullName, setFullName] = useState("")
  // Preselect accounting_firm when the flow param is present; this is a
  // harmless UX hint — the actual signup_intent is written from the selector.
  const [signupIntent, setSignupIntent] = useState<"business_owner" | "accounting_firm">(
    isAccountingFirmFlow ? "accounting_firm" : "business_owner"
  )
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    if (
      STRICT_GATE &&
      !hasTrial &&
      signupIntent === "business_owner" &&
      !hasValidServicePlanContext
    ) {
      setError(
        "Start from our pricing page to choose a plan, or select “I manage accounting for clients” if you are signing up as an accounting firm."
      )
      setLoading(false)
      return
    }

    try {
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL ||
        (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000")

      // Build durable metadata. Trial intent lives here so it survives the
      // email-verification redirect (URL params are gone by then).
      //
      // trial_intent is ALWAYS written — true for website trial links, false for
      // contextless signups. This makes the intent unambiguous at rest and prevents
      // business-setup from needing to distinguish "key absent" from "key = false".
      const userMetadata: Record<string, string | boolean> = {
        full_name:     fullName,
        signup_intent: hasTrial ? "business_owner" : signupIntent,
        trial_intent:  false,   // default; overwritten below if valid trial link
      }

      if (hasTrial && trialWorkspace && trialPlan) {
        userMetadata.trial_workspace = trialWorkspace   // "service"
        userMetadata.trial_plan      = trialPlan        // "starter" | "professional" | "business"
        userMetadata.trial_intent    = true             // explicit flag — prevents accidental activation
      }

      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${appUrl}/auth/callback`,
          data: userMetadata,
        },
      })

      if (authError) {
        setError(authError.message || "Failed to sign up")
        setLoading(false)
        return
      }

      if (data.user) {
        if (!hasTrial && signupIntent === "accounting_firm") {
          router.push("/accounting/firm/setup")
        } else {
          router.push("/business-setup")
        }
      }
    } catch (err: any) {
      setError(err.message || "An error occurred")
      setLoading(false)
    }
  }

  if (shouldBlockAndRedirect) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-100 text-sm text-gray-500">
        Redirecting…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 px-4 py-8">
      <div className="mx-auto w-full max-w-6xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mb-6 flex justify-center">
            <FinzaLogo height={72} />
          </div>
          {hasTrial ? (
            <>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-4 py-1.5 text-xs font-semibold text-blue-700">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                14-day free trial — no credit card required
              </div>
              <h1 className="mb-2 text-3xl font-bold text-gray-900">Start your free trial</h1>
              <p className="text-sm text-gray-600">
                You&apos;re starting a{" "}
                <span className="font-semibold capitalize text-blue-700">
                  {trialPlan === "starter" ? "Essentials" : trialPlan === "professional" ? "Professional" : "Business"}
                </span>{" "}
                trial of the Service workspace.
              </p>
            </>
          ) : (
            <>
              <h1 className="mb-2 text-3xl font-bold text-gray-900">Create your account</h1>
              <p className="text-sm text-gray-600">Get started with your free account today</p>
            </>
          )}
        </div>

        <div className="grid items-start gap-10 lg:grid-cols-2">
          {/* Video first on small screens; right column on large */}
          <div className="order-1 lg:order-2">
            <div className="lg:sticky lg:top-8">
              <h2 className="mb-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-500 lg:text-left">
                How Finza works
              </h2>
              <FinzaDemoVideoEmbed title="How Finza works — see the product before you sign up" />
              <p className="mt-3 text-center text-xs text-gray-500 lg:text-left">
                Short walkthrough of Finza. You can also{" "}
                <button
                  type="button"
                  onClick={() => router.push("/demo")}
                  className="font-semibold text-blue-600 hover:text-blue-700 focus:outline-none focus:underline"
                >
                  open the full demo page
                </button>
                .
              </p>
            </div>
          </div>

          <div className="order-2 lg:order-1">
            <div className="mx-auto w-full max-w-md rounded-2xl border border-gray-100 bg-white p-10 shadow-xl lg:mx-0 lg:max-w-none">
        {/* Signup intent selector — hidden when arriving from a trial link
            (trial always implies business_owner) */}
        {!hasTrial && (
          <div className="mb-6 bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              How will you use Finza?
            </label>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setSignupIntent("accounting_firm")}
                className={`w-full px-4 py-3 rounded-lg text-left transition-all ${
                  signupIntent === "accounting_firm"
                    ? "bg-blue-600 text-white border-2 border-blue-600"
                    : "bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-2 border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🧮</span>
                  <div>
                    <div className="font-medium">I manage accounting for clients</div>
                    <div className="text-xs opacity-80">For accounting firms and bookkeepers</div>
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setSignupIntent("business_owner")}
                className={`w-full px-4 py-3 rounded-lg text-left transition-all ${
                  signupIntent === "business_owner"
                    ? "bg-blue-600 text-white border-2 border-blue-600"
                    : "bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-2 border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🏢</span>
                  <div>
                    <div className="font-medium">I run my own business</div>
                    <div className="text-xs opacity-80">For business owners and operators</div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-400 text-red-700 px-4 py-3 rounded-r mb-6 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span className="text-sm font-medium">{error}</span>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSignup} className="space-y-5">
          <div>
            <label htmlFor="fullName" className="block text-sm font-semibold text-gray-700 mb-2">
              Full name
            </label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 outline-none disabled:bg-gray-50 disabled:cursor-not-allowed"
              placeholder="John Doe"
              required
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-2">
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 outline-none disabled:bg-gray-50 disabled:cursor-not-allowed"
              placeholder="you@example.com"
              required
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-2">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 outline-none disabled:bg-gray-50 disabled:cursor-not-allowed"
              placeholder="At least 6 characters"
              required
              minLength={6}
              disabled={loading}
            />
            <p className="mt-1 text-xs text-gray-500">Must be at least 6 characters long</p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold py-3 rounded-lg hover:from-blue-700 hover:to-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Creating account...
              </span>
            ) : hasTrial ? (
              "Start free trial"
            ) : (
              "Create account"
            )}
          </button>
        </form>

        {/* Login link */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Already have an account?{" "}
            <button
              onClick={() => router.push("/login")}
              className="text-blue-600 font-semibold hover:text-blue-700 transition-colors duration-200 focus:outline-none focus:underline"
            >
              Sign in
            </button>
          </p>
        </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-gray-500">Loading…</div>}>
      <SignupPageInner />
    </Suspense>
  )
}
