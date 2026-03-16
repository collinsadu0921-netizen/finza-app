import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    const business = await getCurrentBusiness(supabase, user?.id || "")
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    // Get or create invoice settings
    const { data: settings, error } = await supabase.rpc("get_or_create_invoice_settings", {
      business_uuid: business.id,
    })

    if (error) {
      // If RPC doesn't work, try direct query
      let { data: settingsData, error: queryError } = await supabase
        .from("invoice_settings")
        .select("*")
        .eq("business_id", business.id)
        .maybeSingle()

      if (queryError && queryError.code !== "PGRST116") {
        console.error("Error fetching invoice settings:", queryError)
        return NextResponse.json(
          { error: queryError.message },
          { status: 500 }
        )
      }

      // If no settings exist, create default
      if (!settingsData) {
        const { data: newSettings, error: insertError } = await supabase
          .from("invoice_settings")
          .insert({
            business_id: business.id,
          })
          .select()
          .single()

        if (insertError) {
          console.error("Error creating invoice settings:", insertError)
          return NextResponse.json(
            { error: insertError.message },
            { status: 500 }
          )
        }

        return NextResponse.json({ settings: newSettings })
      }

      return NextResponse.json({ settings: settingsData })
    }

    return NextResponse.json({ settings })
  } catch (error: any) {
    console.error("Error in invoice settings GET:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    const business = await getCurrentBusiness(supabase, user?.id || "")
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const body = await request.json()

    // Check if settings exist
    const { data: existingSettings } = await supabase
      .from("invoice_settings")
      .select("id")
      .eq("business_id", business.id)
      .maybeSingle()

    let settings
    if (existingSettings) {
      // Update existing
      const { data: updatedSettings, error: updateError } = await supabase
        .from("invoice_settings")
        .update({
          ...body,
          updated_at: new Date().toISOString(),
        })
        .eq("business_id", business.id)
        .select()
        .single()

      if (updateError) {
        console.error("Error updating invoice settings:", updateError)
        return NextResponse.json(
          { error: updateError.message },
          { status: 500 }
        )
      }

      settings = updatedSettings
    } else {
      // Create new
      const { data: newSettings, error: insertError } = await supabase
        .from("invoice_settings")
        .insert({
          business_id: business.id,
          ...body,
        })
        .select()
        .single()

      if (insertError) {
        console.error("Error creating invoice settings:", insertError)
        return NextResponse.json(
          { error: insertError.message },
          { status: 500 }
        )
      }

      settings = newSettings
    }

    return NextResponse.json({ settings })
  } catch (error: any) {
    console.error("Error in invoice settings PUT:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

