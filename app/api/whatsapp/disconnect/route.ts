import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

/**
 * POST /api/whatsapp/disconnect
 * Disconnect WhatsApp connection for business
 */
export async function POST(request: NextRequest) {
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

    // Clear WhatsApp connection details
    const { error: updateError } = await supabase
      .from("businesses")
      .update({
        whatsapp_connected: false,
        whatsapp_business_id: null,
        whatsapp_phone_number_id: null,
        whatsapp_phone_number: null,
        whatsapp_access_token_encrypted: null,
        whatsapp_token_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", business.id)

    if (updateError) {
      console.error("Error disconnecting WhatsApp:", updateError)
      return NextResponse.json(
        { error: updateError.message || "Failed to disconnect WhatsApp" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: "WhatsApp disconnected successfully",
    })
  } catch (error: any) {
    console.error("Error disconnecting WhatsApp:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}













