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

    const { searchParams } = new URL(request.url)
    const business_id = searchParams.get("business_id")

    if (!business_id) {
      return NextResponse.json(
        { error: "business_id is required" },
        { status: 400 }
      )
    }

    // Validate business_id is a valid UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(business_id)) {
      return NextResponse.json(
        { error: "Invalid business_id format" },
        { status: 400 }
      )
    }

    // Ensure default automations are seeded for this business
    // Only attempt if table exists (checked by query above)
    try {
      const { error: seedError } = await supabase.rpc("seed_default_automations", {
        business_uuid: business_id,
      })
      
      if (seedError) {
        console.error("Error seeding default automations:", seedError)
        // Continue anyway - don't fail if seeding fails (function may not exist if migration not run)
      }
    } catch (seedErr: any) {
      console.error("Exception seeding default automations:", seedErr)
      // Continue anyway - don't fail if seeding fails (function may not exist if migration not run)
    }

    // Fetch automations
    const { data: automations, error } = await supabase
      .from("automations")
      .select("*")
      .eq("business_id", business_id)
      .order("created_at", { ascending: true })

    if (error) {
      console.error("Error fetching automations:", error)
      
      // Handle case where automations table doesn't exist yet
      if (error.message?.includes("does not exist") || error.code === "42P01" || error.message?.includes("schema cache")) {
        console.warn("Automations table not found - migration may not have been applied yet")
        return NextResponse.json(
          { 
            error: "Automations feature is not available yet. Please run migration 079_create_automations.sql to enable this feature.",
            automations: [] // Return empty array instead of failing
          },
          { status: 503 } // Service Unavailable
        )
      }
      
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ automations: automations || [] })
  } catch (error: any) {
    console.error("Error in GET automations:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}













