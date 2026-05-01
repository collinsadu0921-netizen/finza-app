"use client"

import { Suspense, useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter, useSearchParams } from "next/navigation"
import {
  DEFAULT_SERVICE_SUBSCRIPTION_TIER,
  tryParseServiceSubscriptionTier,
} from "@/lib/serviceWorkspace/subscriptionTiers"
import { tryParseBillingCycle } from "@/lib/serviceWorkspace/subscriptionPricing"
import { FinzaLogo } from "@/components/FinzaLogo"
import { FinzaDemoVideoEmbed } from "@/components/marketing/FinzaDemoVideoEmbed"
import { buildOAuthRedirectToWithMarketingContext, signInWithGoogle } from "@/lib/auth/startGoogleAuth"

/**
 * Valid workspaces that support the trial flow in URL + metadata.
 * Public signup is Service-only; retail/accounting are not selectable or honored here.
 */
const TRIAL_SUPPORTED_WORKSPACES = ["service"] as const

const STRICT_GATE =
  process.env.NEXT_PUBLIC_SIGNUP_REQUIRE_SERVICE_PLAN_CONTEXT === "true"

function isValidServicePlanParam(raw: string): boolean {
  return tryParseServiceSubscriptionTier(raw) !== null
}

function SignupPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const rawWorkspace = searchParams.get("workspace") ?? ""
  const workspaceNormalized = rawWorkspace.trim().toLowerCase()
  const rawPlan = searchParams.get("plan") ?? ""
  const rawTrial = searchParams.get("trial") ?? ""
  const rawBillingCycle = searchParams.get("billing_cycle") ?? searchParams.get("cycle") ?? ""
  const parsedBillingCycle = tryParseBillingCycle(rawBillingCycle)

  const hasValidServicePlanContext =
    workspaceNormalized === "service" && isValidServicePlanParam(rawPlan)

  const trialWorkspace = (TRIAL_SUPPORTED_WORKSPACES as readonly string[]).includes(workspaceNormalized)
    ? "service"
    : null
  const trialTierForSignup =
    trialWorkspace ? tryParseServiceSubscriptionTier(rawPlan) ?? DEFAULT_SERVICE_SUBSCRIPTION_TIER : null
  const hasTrial = trialWorkspace !== null && rawTrial === "1"

  const shouldBlockAndRedirect =
    STRICT_GATE && !hasValidServicePlanContext && !hasTrial

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

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleGoogle = async () => {
    setError("")
    setLoading(true)
    try {
      const redirectTo = buildOAuthRedirectToWithMarketingContext({
        plan: rawPlan,
        trial: rawTrial,
        workspace: trialWorkspace ?? rawWorkspace,
        billing_cycle: searchParams.get("billing_cycle") ?? undefined,
        cycle: searchParams.get("cycle") ?? undefined,
      })
      const { error: oauthError } = await signInWithGoogle(redirectTo)
      if (oauthError) {
        setError(oauthError.message || "Could not start Google sign-in")
        setLoading(false)
      }
    } catch (err: any) {
      setError(err.message || "Could not start Google sign-in")
      setLoading(false)
    }
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    if (STRICT_GATE && !hasTrial && !hasValidServicePlanContext) {
      setError("Start from our pricing page to choose a plan.")
      setLoading(false)
      return
    }

    try {
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL ||
        (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000")

      const userMetadata: Record<string, string | boolean> = {
        full_name: fullName,
        signup_intent: "business_owner",
        trial_intent: false,
      }

      if (hasTrial && trialWorkspace && trialTierForSignup) {
        userMetadata.trial_workspace = trialWorkspace
        userMetadata.trial_plan = trialTierForSignup
        userMetadata.trial_intent = true
        if (parsedBillingCycle) {
          userMetadata.signup_billing_cycle = parsedBillingCycle
        }
      } else {
        const parsed = tryParseServiceSubscriptionTier(rawPlan)
        if (parsed) {
          userMetadata.signup_service_plan = parsed
        }
        if (parsedBillingCycle) {
          userMetadata.signup_billing_cycle = parsedBillingCycle
        }
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
        setLoading(false)
        if (data.session) {
          router.push("/business-setup")
        } else {
          router.push(`/signup/check-email?email=${encodeURIComponent(email.trim())}`)
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
                  {trialTierForSignup === "starter"
                    ? "Essentials"
                    : trialTierForSignup === "professional"
                      ? "Professional"
                      : "Business"}
                </span>{" "}
                trial of Finza Service.
              </p>
            </>
          ) : (
            <>
              <h1 className="mb-2 text-3xl font-bold text-gray-900">Create your account</h1>
              <p className="text-sm text-gray-600 max-w-lg mx-auto">
                Start with Finza Service. Create quotes, invoices, receipts and track payments for your Ghanaian service
                business.
              </p>
            </>
          )}
        </div>

        <div className="grid items-start gap-10 lg:grid-cols-2">
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
              {error && (
                <div className="bg-red-50 border-l-4 border-red-400 text-red-700 px-4 py-3 rounded-r mb-6 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex items-center">
                    <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span className="text-sm font-medium">{error}</span>
                  </div>
                </div>
              )}

              <div className="space-y-5">
                <button
                  type="button"
                  onClick={() => void handleGoogle()}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-3 rounded-lg border-2 border-gray-200 bg-white py-3 px-4 font-semibold text-gray-800 hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Continue with Google
                </button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-gray-200" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-2 text-gray-500">or sign up with email</span>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSignup} className="space-y-5 mt-6">
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
                      <svg
                        className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
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

              <div className="mt-6 text-center">
                <p className="text-sm text-gray-600">
                  Already have an account?{" "}
                  <button
                    type="button"
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
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">Loading…</div>
      }
    >
      <SignupPageInner />
    </Suspense>
  )
}
