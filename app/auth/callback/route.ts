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

    // Step 9.3 Batch C: Check signup intent for routing
    const signupIntent = user.user_metadata?.signup_intent || "business_owner"

    // Check if user has a business (existing user; exclude archived)
    const { data: business } = await supabase
      .from("businesses")
      .select("id")
      .eq("owner_id", user.id)
      .is("archived_at", null)
      .maybeSingle()

    // If user has a business, redirect to dashboard
    if (business) {
      return NextResponse.redirect(`${requestUrl.origin}/dashboard`)
    }

    // Step 9.3 Batch C: Route new users based on signup intent
    if (signupIntent === "accounting_firm") {
      // Check if user already belongs to a firm
      const { data: firmUser } = await supabase
        .from("accounting_firm_users")
        .select("firm_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle()

      if (firmUser) {
        // Already in a firm, go to firm dashboard
        return NextResponse.redirect(`${requestUrl.origin}/accounting/firm`)
      } else {
        // Not in a firm yet, go to firm setup
        return NextResponse.redirect(`${requestUrl.origin}/accounting/firm/setup`)
      }
    } else {
      // Default: business owner flow (unchanged)
      return NextResponse.redirect(`${requestUrl.origin}/business-setup`)
    }
  } catch (error: any) {
    console.error("Unexpected error in auth callback:", error)
    return NextResponse.redirect(
      `${requestUrl.origin}/login?error=${encodeURIComponent(error.message || "unknown_error")}`
    )
  }
}

