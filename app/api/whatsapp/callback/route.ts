import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

/**
 * GET /api/whatsapp/callback
 * OAuth callback from Meta after user authorizes WhatsApp access
 * Exchanges code for access token and stores connection details
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get("code")
    const state = searchParams.get("state")
    const error = searchParams.get("error")

    if (error) {
      console.error("OAuth error:", error)
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/integrations/whatsapp?error=${encodeURIComponent(error)}`
      )
    }

    if (!code || !state) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/integrations/whatsapp?error=missing_parameters`
      )
    }

    // Decode state to get business and user info
    let stateData: { businessId: string; userId: string }
    try {
      stateData = JSON.parse(Buffer.from(state, "base64url").toString())
    } catch (e) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/integrations/whatsapp?error=invalid_state`
      )
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user || user.id !== stateData.userId) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/integrations/whatsapp?error=unauthorized`
      )
    }

    // Exchange code for access token
    const clientId = process.env.META_WHATSAPP_APP_ID
    const clientSecret = process.env.META_WHATSAPP_APP_SECRET
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/whatsapp/callback`

    if (!clientId || !clientSecret) {
      console.error("Meta WhatsApp credentials not configured")
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/integrations/whatsapp?error=not_configured`
      )
    }

    // Exchange authorization code for access token
    const tokenResponse = await fetch(
      `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${clientId}&client_secret=${clientSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      }
    )

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}))
      console.error("Error exchanging code for token:", errorData)
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/integrations/whatsapp?error=token_exchange_failed`
      )
    }

    const tokenData = await tokenResponse.json()
    const accessToken = tokenData.access_token

    if (!accessToken) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/integrations/whatsapp?error=no_token`
      )
    }

    // Get long-lived token (optional - for tokens that expire)
    // For now, use short-lived token - implement token refresh later if needed

    // Get user's Meta Business Accounts
    const businessAccountsResponse = await fetch(
      `https://graph.facebook.com/v18.0/me/businesses?access_token=${accessToken}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      }
    )

    if (!businessAccountsResponse.ok) {
      console.error("Error fetching business accounts")
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/integrations/whatsapp?error=business_accounts_failed`
      )
    }

    const businessAccountsData = await businessAccountsResponse.json()
    const businesses = businessAccountsData.data || []

    if (businesses.length === 0) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/integrations/whatsapp?error=no_business_accounts`
      )
    }

    // For now, use the first business account
    // TODO: Allow user to select which business account to use
    const selectedBusiness = businesses[0]
    const metaBusinessId = selectedBusiness.id

    // Get WhatsApp phone numbers for this business
    const phoneNumbersResponse = await fetch(
      `https://graph.facebook.com/v18.0/${metaBusinessId}/owned_phone_numbers?access_token=${accessToken}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      }
    )

    if (!phoneNumbersResponse.ok) {
      console.error("Error fetching phone numbers")
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/integrations/whatsapp?error=phone_numbers_failed`
      )
    }

    const phoneNumbersData = await phoneNumbersResponse.json()
    const phoneNumbers = phoneNumbersData.data || []

    if (phoneNumbers.length === 0) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/integrations/whatsapp?error=no_phone_numbers`
      )
    }

    // Use the first phone number
    // TODO: Allow user to select which phone number to use
    const selectedPhoneNumber = phoneNumbers[0]
    const phoneNumberId = selectedPhoneNumber.id
    const phoneNumber = selectedPhoneNumber.display_phone_number || selectedPhoneNumber.verified_name || "Unknown"

    // TODO: Encrypt access token before storing
    // For now, store as-is (in production, use encryption)
    // Consider using Supabase Vault or application-level encryption
    const encryptedToken = accessToken // TODO: Encrypt this

    // Store connection details in database
    const { error: updateError } = await supabase
      .from("businesses")
      .update({
        whatsapp_connected: true,
        whatsapp_business_id: metaBusinessId,
        whatsapp_phone_number_id: phoneNumberId,
        whatsapp_phone_number: phoneNumber,
        whatsapp_access_token_encrypted: encryptedToken,
        whatsapp_token_expires_at: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", stateData.businessId)

    if (updateError) {
      console.error("Error saving WhatsApp connection:", updateError)
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/integrations/whatsapp?error=save_failed`
      )
    }

    // Redirect to settings page with success message
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/integrations/whatsapp?success=connected`
    )
  } catch (error: any) {
    console.error("Error in WhatsApp callback:", error)
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/integrations/whatsapp?error=${encodeURIComponent(error.message || "unknown_error")}`
    )
  }
}

