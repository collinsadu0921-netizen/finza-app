"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"
import { useRouter, useSearchParams } from "next/navigation"
import {
  DEFAULT_SERVICE_SUBSCRIPTION_TIER,
  tryParseServiceSubscriptionTier,
} from "@/lib/serviceWorkspace/subscriptionTiers"
import { tryParseBillingCycle } from "@/lib/serviceWorkspace/subscriptionPricing"
import { FinzaLogo } from "@/components/FinzaLogo"
import { buildOAuthRedirectToWithMarketingContext, signInWithGoogle } from "@/lib/auth/startGoogleAuth"
import {
  mergeSignupAttribution,
  parseSignupAttributionFromSearchParams,
  persistSignupAttributionToSession,
  readSignupAttributionFromSession,
  signupAttributionToUserMetadata,
} from "@/lib/growth/signupAttribution"
import {
  parseSignupWorkspaceParam,
  signupIntentForWorkspace,
  resolveImmediatePostSignupPath,
  type SignupWorkspaceChoice,
} from "@/lib/auth/signupWorkspace"

const TRIAL_SUPPORTED_WORKSPACES = ["service"] as const

const STRICT_GATE =
  process.env.NEXT_PUBLIC_SIGNUP_REQUIRE_SERVICE_PLAN_CONTEXT === "true"

function isValidServicePlanParam(raw: string): boolean {
  return tryParseServiceSubscriptionTier(raw) !== null
}

function GoogleIcon() {
  return (
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
  )
}

function WorkspaceChoiceCard({
  title,
  subtitle,
  description,
  selected,
  onSelect,
}: {
  title: string
  subtitle: string
  description: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border p-4 text-left transition-colors ${
        selected
          ? "border-gray-900 bg-gray-50 ring-1 ring-gray-900"
          : "border-gray-200 bg-white hover:border-gray-300"
      }`}
    >
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="text-xs font-medium text-gray-500 mt-0.5">{subtitle}</p>
      <p className="text-sm text-gray-600 mt-2">{description}</p>
    </button>
  )
}

function SignupPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const urlWorkspace = parseSignupWorkspaceParam(searchParams.get("workspace"))
  const [selectedWorkspace, setSelectedWorkspace] = useState<SignupWorkspaceChoice | null>(urlWorkspace)

  useEffect(() => {
    if (urlWorkspace) setSelectedWorkspace(urlWorkspace)
  }, [urlWorkspace])

  const activeWorkspace = selectedWorkspace
  const isPractice = activeWorkspace === "practice"
  const isService = activeWorkspace === "service"

  const rawPlan = searchParams.get("plan") ?? ""
  const rawTrial = searchParams.get("trial") ?? ""
  const rawBillingCycle = searchParams.get("billing_cycle") ?? searchParams.get("cycle") ?? ""
  const parsedBillingCycle = tryParseBillingCycle(rawBillingCycle)

  const hasValidServicePlanContext = isService && isValidServicePlanParam(rawPlan)
  const trialWorkspace =
    isService && (TRIAL_SUPPORTED_WORKSPACES as readonly string[]).includes("service") ? "service" : null
  const trialTierForSignup = trialWorkspace
    ? tryParseServiceSubscriptionTier(rawPlan) ?? DEFAULT_SERVICE_SUBSCRIPTION_TIER
    : null
  const hasTrial = trialWorkspace !== null && rawTrial === "1"

  const shouldBlockAndRedirect =
    STRICT_GATE && isService && !hasValidServicePlanContext && !hasTrial

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

  useEffect(() => {
    const fromUrl = parseSignupAttributionFromSearchParams(searchParams)
    const fromSession = readSignupAttributionFromSession()
    const merged = mergeSignupAttribution(fromSession ?? fromUrl, fromUrl)
    persistSignupAttributionToSession(merged)
  }, [searchParams])

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const oauthWorkspace = activeWorkspace ?? undefined

  const handleGoogle = async () => {
    if (!activeWorkspace) {
      setError("Choose Finza Service or Finza Practice to continue.")
      return
    }
    setError("")
    setLoading(true)
    try {
      const redirectTo = buildOAuthRedirectToWithMarketingContext({
        plan: isPractice ? null : rawPlan,
        trial: isPractice ? null : rawTrial,
        workspace: oauthWorkspace,
        billing_cycle: isPractice ? undefined : searchParams.get("billing_cycle") ?? undefined,
        cycle: isPractice ? undefined : searchParams.get("cycle") ?? undefined,
        attribution: mergeSignupAttribution(
          readSignupAttributionFromSession() ?? parseSignupAttributionFromSearchParams(searchParams),
          parseSignupAttributionFromSearchParams(searchParams)
        ),
      })
      const { error: oauthError } = await signInWithGoogle(redirectTo)
      if (oauthError) {
        setError(oauthError.message || "Could not start Google sign-in")
        setLoading(false)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not start Google sign-in")
      setLoading(false)
    }
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeWorkspace) {
      setError("Choose Finza Service or Finza Practice to continue.")
      return
    }
    setError("")
    setLoading(true)

    if (STRICT_GATE && isService && !hasTrial && !hasValidServicePlanContext) {
      setError("Start from our pricing page to choose a plan.")
      setLoading(false)
      return
    }

    try {
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL ||
        (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000")

      const signupIntent = signupIntentForWorkspace(activeWorkspace)

      const userMetadata: Record<string, string | boolean> = {
        full_name: fullName,
        signup_intent: signupIntent,
        trial_intent: false,
        ...signupAttributionToUserMetadata(
          mergeSignupAttribution(
            readSignupAttributionFromSession() ?? parseSignupAttributionFromSearchParams(searchParams),
            parseSignupAttributionFromSearchParams(searchParams)
          )
        ),
      }

      if (isService) {
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
      }

      const callbackUrl = new URL("/auth/callback", appUrl)
      callbackUrl.searchParams.set("workspace", activeWorkspace)

      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: callbackUrl.toString(),
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
          router.push(resolveImmediatePostSignupPath(signupIntent))
        } else {
          const qs = new URLSearchParams({
            email: email.trim(),
            workspace: activeWorkspace,
          })
          router.push(`/signup/check-email?${qs.toString()}`)
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred")
      setLoading(false)
    }
  }

  if (shouldBlockAndRedirect) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-gray-500">
        Redirecting…
      </div>
    )
  }

  const showChoice = !activeWorkspace

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-6 flex justify-center">
            <FinzaLogo height={64} />
          </div>
          {hasTrial && isService ? (
            <>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-4 py-1.5 text-xs font-semibold text-blue-700">
                14-day free trial — no credit card required
              </div>
              <h1 className="mb-2 text-2xl font-bold text-gray-900">Start your free trial</h1>
              <p className="text-sm text-gray-600">
                Finza Service —{" "}
                <span className="font-semibold text-blue-700">
                  {trialTierForSignup === "starter"
                    ? "Essentials"
                    : trialTierForSignup === "professional"
                      ? "Professional"
                      : "Business"}
                </span>
              </p>
            </>
          ) : (
            <>
              <h1 className="mb-2 text-2xl font-bold text-gray-900">Create your Finza account</h1>
              <p className="text-sm text-gray-600">
                {showChoice
                  ? "What are you using Finza for?"
                  : isPractice
                    ? "Sign up for Finza Practice to manage client work and books."
                    : "Sign up for Finza Service to run your business."}
              </p>
            </>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {showChoice ? (
            <div className="space-y-3">
              <WorkspaceChoiceCard
                title="Run my business"
                subtitle="Finza Service"
                description="Quotes, invoices, expenses, payroll and business accounting."
                selected={selectedWorkspace === "service"}
                onSelect={() => {
                  setSelectedWorkspace("service")
                  router.replace("/signup?workspace=service", { scroll: false })
                }}
              />
              <WorkspaceChoiceCard
                title="Manage accounting clients"
                subtitle="Finza Practice"
                description="Manage client work, staff assignments, reviews and client books."
                selected={selectedWorkspace === "practice"}
                onSelect={() => {
                  setSelectedWorkspace("practice")
                  router.replace("/signup?workspace=practice", { scroll: false })
                }}
              />
              <p className="pt-2 text-center text-sm text-gray-600">
                Already have an account?{" "}
                <Link href="/login" className="font-semibold text-blue-600 hover:text-blue-700">
                  Sign in
                </Link>
              </p>
            </div>
          ) : (
            <>
              {!urlWorkspace && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedWorkspace(null)
                    router.replace("/signup", { scroll: false })
                  }}
                  className="mb-4 text-sm text-gray-500 hover:text-gray-700"
                >
                  ← Change product
                </button>
              )}

              <div className="space-y-4 mb-6">
                <button
                  type="button"
                  onClick={() => void handleGoogle()}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-3 rounded-lg border border-gray-200 bg-white py-3 px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  <GoogleIcon />
                  Continue with Google
                </button>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-gray-200" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-2 text-gray-400">or sign up with email</span>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSignup} className="space-y-4">
                <div>
                  <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-1">
                    Full name
                  </label>
                  <input
                    id="fullName"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    placeholder="John Doe"
                    required
                    disabled={loading}
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    placeholder="you@example.com"
                    required
                    disabled={loading}
                  />
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    placeholder="At least 6 characters"
                    required
                    minLength={6}
                    disabled={loading}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-gray-900 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {loading ? "Creating account…" : hasTrial && isService ? "Start free trial" : "Create account"}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-gray-600">
                Already have an account?{" "}
                <Link href="/login" className="font-semibold text-blue-600 hover:text-blue-700">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-gray-500">
          Loading…
        </div>
      }
    >
      <SignupPageInner />
    </Suspense>
  )
}
