import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

/**
 * GET /api/whatsapp/connect
 * Initiate WhatsApp OAuth connection
 * Redirects user to Meta OAuth flow
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    // Meta OAuth configuration
    const clientId = process.env.META_WHATSAPP_APP_ID
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/whatsapp/callback`
    const scope = "whatsapp_business_management,business_management"

    if (!clientId) {
      console.error("META_WHATSAPP_APP_ID not configured")
      return NextResponse.json(
        { error: "WhatsApp integration not configured. Please contact support." },
        { status: 500 }
      )
    }

    // Generate state parameter for OAuth security
    const state = Buffer.from(JSON.stringify({ businessId: business.id, userId: user.id })).toString("base64url")

    // Meta OAuth URL
    const authUrl = new URL("https://www.facebook.com/v18.0/dialog/oauth")
    authUrl.searchParams.set("client_id", clientId)
    authUrl.searchParams.set("redirect_uri", redirectUri)
    authUrl.searchParams.set("scope", scope)
    authUrl.searchParams.set("state", state)
    authUrl.searchParams.set("response_type", "code")

    // Redirect to Meta OAuth
    return NextResponse.redirect(authUrl.toString())
  } catch (error: any) {
    console.error("Error initiating WhatsApp connection:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}













