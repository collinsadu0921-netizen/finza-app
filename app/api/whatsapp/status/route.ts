import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

/**
 * GET /api/whatsapp/status
 * Get WhatsApp connection status for current business
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

    // Return connection status (don't expose access token)
    return NextResponse.json({
      connected: business.whatsapp_connected || false,
      phone_number: business.whatsapp_phone_number || null,
      business_id: business.whatsapp_business_id || null,
      phone_number_id: business.whatsapp_phone_number_id || null,
      token_expires_at: business.whatsapp_token_expires_at || null,
    })
  } catch (error: any) {
    console.error("Error fetching WhatsApp status:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}













