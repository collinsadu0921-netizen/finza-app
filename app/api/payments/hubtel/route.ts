import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { normalizeCountry, assertProviderAllowed } from "@/lib/payments/eligibility"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { business_id } = body

    if (!business_id) {
      return NextResponse.json(
        { status: "failed", message: "Missing business_id" },
        { status: 400 }
      )
    }

    // Load business Hubtel settings and country
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("hubtel_settings, address_country")
      .eq("id", business_id)
      .single()

    if (businessError || !business) {
      return NextResponse.json(
        { status: "failed", message: "Business not found" },
        { status: 404 }
      )
    }

    // Check provider eligibility by country
    const countryCode = normalizeCountry(business.address_country)
    
    try {
      assertProviderAllowed(countryCode, "hubtel")
    } catch (error: any) {
      return NextResponse.json(
        { 
          status: "failed", 
          message: error.message || "Payment method/provider not available for your country."
        },
        { status: 403 }
      )
    }

    const hubtelSettings = business.hubtel_settings as {
      pos_key?: string
      secret?: string
      merchant_account_number?: string
    } | null

    if (!hubtelSettings || !hubtelSettings.pos_key || !hubtelSettings.secret) {
      return NextResponse.json(
        { status: "failed", message: "Hubtel settings not configured" },
        { status: 400 }
      )
    }

    // Hubtel implementation not yet available
    return NextResponse.json({
      status: "not_implemented_yet",
      message: "Hubtel payment integration coming soon",
    })
  } catch (error: any) {
    return NextResponse.json(
      { status: "failed", message: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


















