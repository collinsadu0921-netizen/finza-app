"use client"

import { supabase } from "@/lib/supabaseClient"
import { getPublicAppUrl } from "@/lib/auth/publicAppUrl"

/** Build `/auth/callback` with optional marketing params preserved through Google OAuth. */
export function buildOAuthRedirectToWithMarketingContext(opts: {
  plan?: string | null
  trial?: string | null
  /** Only "service" is forwarded (public Finza Service signup). */
  workspace?: string | null
}): string {
  const base = getPublicAppUrl().replace(/\/$/, "")
  const u = new URL("/auth/callback", base)
  const plan = opts.plan?.trim()
  if (plan) u.searchParams.set("plan", plan)
  if (opts.trial === "1") u.searchParams.set("trial", "1")
  if (opts.workspace?.trim().toLowerCase() === "service") {
    u.searchParams.set("workspace", "service")
  }
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
