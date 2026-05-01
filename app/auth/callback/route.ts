import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { tryParseServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"
import {
  resolveBusinessDashboardRedirect,
  shouldApplyServiceMarketingMetadataFromUrl,
  urlIndicatesServiceMarketingContext,
} from "@/lib/auth/callbackPostAuthRouting"

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> }

/**
 * GET /auth/callback
 * PKCE / OAuth / email confirmation: exchange `code` for a session, then redirect.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const error = requestUrl.searchParams.get("error")
  const errorDescription = requestUrl.searchParams.get("error_description")

  if (error) {
    console.error("Auth callback error:", error, errorDescription)
    return NextResponse.redirect(
      `${requestUrl.origin}/login?error=${encodeURIComponent(errorDescription || error)}`
    )
  }

  if (!code) {
    return NextResponse.redirect(`${requestUrl.origin}/login?error=no_code`)
  }

  const pendingCookies: CookieToSet[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach((c) => pendingCookies.push(c))
        },
      },
    }
  )

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    console.error("exchangeCodeForSession:", exchangeError)
    return NextResponse.redirect(
      `${requestUrl.origin}/login?error=${encodeURIComponent(exchangeError.message)}`
    )
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    const res = NextResponse.redirect(`${requestUrl.origin}/login?error=no_user`)
    pendingCookies.forEach(({ name, value, options }) => {
      if (options && typeof options === "object") {
        res.cookies.set(name, value, options as Parameters<typeof res.cookies.set>[2])
      } else {
        res.cookies.set(name, value)
      }
    })
    return res
  }

  const planParam = requestUrl.searchParams.get("plan")
  const trialParam = requestUrl.searchParams.get("trial")
  const workspaceParam = (requestUrl.searchParams.get("workspace") ?? "").trim().toLowerCase()
  const parsedPlan = tryParseServiceSubscriptionTier(planParam)

  const rawMeta = { ...(user.user_metadata as Record<string, unknown>) }
  const existingSignupIntent =
    typeof rawMeta.signup_intent === "string" ? rawMeta.signup_intent : undefined

  let effectiveMeta: Record<string, unknown> = rawMeta

  if (shouldApplyServiceMarketingMetadataFromUrl(parsedPlan, existingSignupIntent)) {
    const isServiceTrialLink = trialParam === "1" && workspaceParam === "service"
    if (isServiceTrialLink) {
      effectiveMeta = {
        ...effectiveMeta,
        signup_intent: "business_owner",
        trial_intent: true,
        trial_workspace: "service",
        trial_plan: parsedPlan,
      }
    } else {
      effectiveMeta = {
        ...effectiveMeta,
        signup_intent: "business_owner",
        signup_service_plan: parsedPlan,
      }
    }
    try {
      const admin = createSupabaseAdminClient()
      await admin.auth.admin.updateUserById(user.id, { user_metadata: effectiveMeta })
    } catch (e) {
      console.warn("[auth/callback] metadata merge failed (SERVICE_ROLE?):", e)
    }
  }

  const signupIntent = (effectiveMeta.signup_intent as string) || "business_owner"
  const trialWorkspace = effectiveMeta.trial_workspace ?? null
  const trialPlan = effectiveMeta.trial_plan ?? null
  const trialIntent = effectiveMeta.trial_intent === true

  const urlPrefersService = urlIndicatesServiceMarketingContext(workspaceParam, trialParam, parsedPlan)

  const { data: ownedRows, error: ownedErr } = await supabase
    .from("businesses")
    .select("id, industry, created_at")
    .eq("owner_id", user.id)
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(50)

  const origin = requestUrl.origin
  let redirectUrl: URL

  if (ownedErr) {
    console.error("[auth/callback] businesses query:", ownedErr.message)
    redirectUrl = new URL("/", origin)
  } else {
    const businesses = Array.isArray(ownedRows) ? ownedRows : []

    if (businesses.length > 0) {
      redirectUrl = new URL(resolveBusinessDashboardRedirect(businesses, urlPrefersService), origin)
    } else if (trialIntent && trialWorkspace === "service" && trialPlan) {
      redirectUrl = new URL("/business-setup", origin)
    } else if (signupIntent === "accounting_firm") {
      const { data: firmUser, error: firmErr } = await supabase
        .from("accounting_firm_users")
        .select("firm_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle()

      if (firmErr) {
        console.error("[auth/callback] accounting_firm_users:", firmErr.message)
      }

      redirectUrl = firmUser
        ? new URL("/accounting/firm", origin)
        : new URL("/accounting/firm/setup", origin)
    } else {
      redirectUrl = new URL("/business-setup", origin)
    }
  }

  const res = NextResponse.redirect(redirectUrl)
  pendingCookies.forEach(({ name, value, options }) => {
    if (options && typeof options === "object") {
      res.cookies.set(name, value, options as Parameters<typeof res.cookies.set>[2])
    } else {
      res.cookies.set(name, value)
    }
  })
  return res
}
