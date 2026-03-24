import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

/**
 * GET /auth/callback
 * Handles email confirmation redirects from Supabase
 * Exchanges the code for a session and redirects user appropriately
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const error = requestUrl.searchParams.get("error")
  const errorDescription = requestUrl.searchParams.get("error_description")

  // Handle errors
  if (error) {
    console.error("Auth callback error:", error, errorDescription)
    return NextResponse.redirect(
      `${requestUrl.origin}/login?error=${encodeURIComponent(errorDescription || error)}`
    )
  }

  // If no code, redirect to login
  if (!code) {
    return NextResponse.redirect(`${requestUrl.origin}/login?error=no_code`)
  }

  try {
    // Create Supabase server client
    // The code in the URL will be automatically exchanged for a session by Supabase SSR
    const supabase = await createSupabaseServerClient()

    // Get user after code exchange (Supabase SSR handles the exchange automatically)
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError) {
      console.error("Error getting user after code exchange:", userError)
      return NextResponse.redirect(
        `${requestUrl.origin}/login?error=${encodeURIComponent(userError.message)}`
      )
    }

    if (!user) {
      return NextResponse.redirect(`${requestUrl.origin}/login?error=no_user`)
    }

    const signupIntent   = user.user_metadata?.signup_intent  || "business_owner"
    // Trial intent — stored in metadata during signup so it survives this redirect.
    // trial_workspace is only set for finished workspaces (currently "service" only).
    const trialWorkspace = user.user_metadata?.trial_workspace ?? null
    const trialPlan      = user.user_metadata?.trial_plan      ?? null
    const trialIntent    = user.user_metadata?.trial_intent    === true

    // Check if user already has a business (returning / existing user)
    const { data: business } = await supabase
      .from("businesses")
      .select("id")
      .eq("owner_id", user.id)
      .is("archived_at", null)
      .maybeSingle()

    // Existing user with a business → go straight to dashboard
    if (business) {
      return NextResponse.redirect(`${requestUrl.origin}/dashboard`)
    }

    // Trial signup from marketing site (workspace=service&plan=…&trial=1)
    // Route to business-setup; the trial fields in metadata are picked up there.
    if (trialIntent && trialWorkspace === "service" && trialPlan) {
      return NextResponse.redirect(`${requestUrl.origin}/business-setup`)
    }

    // Accounting firm signup
    if (signupIntent === "accounting_firm") {
      const { data: firmUser } = await supabase
        .from("accounting_firm_users")
        .select("firm_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle()

      if (firmUser) {
        return NextResponse.redirect(`${requestUrl.origin}/accounting/firm`)
      } else {
        return NextResponse.redirect(`${requestUrl.origin}/accounting/firm/setup`)
      }
    }

    // Default: business owner flow
    return NextResponse.redirect(`${requestUrl.origin}/business-setup`)
  } catch (error: any) {
    console.error("Unexpected error in auth callback:", error)
    return NextResponse.redirect(
      `${requestUrl.origin}/login?error=${encodeURIComponent(error.message || "unknown_error")}`
    )
  }
}

