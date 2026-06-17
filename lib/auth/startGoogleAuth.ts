"use client"

import { supabase } from "@/lib/supabaseClient"
import { getPublicAppUrl } from "@/lib/auth/publicAppUrl"
import { tryParseBillingCycle } from "@/lib/serviceWorkspace/subscriptionPricing"
import {
  type SignupAttribution,
  parseSignupAttributionFromSearchParams,
  persistSignupAttributionToSession,
  signupAttributionToUserMetadata,
} from "@/lib/growth/signupAttribution"

/** Build `/auth/callback` with optional marketing params preserved through Google OAuth. */
export function buildOAuthRedirectToWithMarketingContext(opts: {
  plan?: string | null
  trial?: string | null
  workspace?: string | null
  billing_cycle?: string | null
  cycle?: string | null
  attribution?: SignupAttribution | null
}): string {
  const base = getPublicAppUrl().replace(/\/$/, "")
  const u = new URL("/auth/callback", base)
  const plan = opts.plan?.trim()
  if (plan) u.searchParams.set("plan", plan)
  if (opts.trial === "1") u.searchParams.set("trial", "1")
  if (opts.workspace?.trim().toLowerCase() === "service") {
    u.searchParams.set("workspace", "service")
  }
  const parsed = tryParseBillingCycle(opts.billing_cycle ?? opts.cycle ?? null)
  if (parsed) {
    u.searchParams.set("billing_cycle", parsed)
  }
  const attr = opts.attribution
  if (attr?.signup_utm_source) u.searchParams.set("utm_source", attr.signup_utm_source)
  if (attr?.signup_utm_medium) u.searchParams.set("utm_medium", attr.signup_utm_medium)
  if (attr?.signup_utm_campaign) u.searchParams.set("utm_campaign", attr.signup_utm_campaign)
  if (attr?.signup_source) u.searchParams.set("ref", attr.signup_source)
  return u.toString()
}

export async function signInWithGoogle(redirectTo: string) {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  })
  if (error) return { error }
  if (typeof window !== "undefined" && data?.url) {
    window.location.assign(data.url)
  }
  return { error: null }
}
