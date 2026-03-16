import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const resolvedParams = await Promise.resolve(params)
    const automationId = resolvedParams.id

    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    const body = await request.json()
    const { enabled } = body

    if (typeof enabled !== "boolean") {
      return NextResponse.json(
        { error: "enabled must be a boolean" },
        { status: 400 }
      )
    }

    // Update automation enabled state
    const { data: automation, error } = await supabase
      .from("automations")
      .update({
        enabled,
        updated_at: new Date().toISOString(),
      })
      .eq("id", automationId)
      .select()
      .single()

    if (error) {
      console.error("Error updating automation:", error)
      
      // Handle case where automations table doesn't exist yet
      if (error.message?.includes("does not exist") || error.code === "42P01" || error.message?.includes("schema cache")) {
        return NextResponse.json(
          { 
            error: "Automations feature is not available yet. Please run migration 079_create_automations.sql to enable this feature."
          },
          { status: 503 } // Service Unavailable
        )
      }
      
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      success: true,
      automation 
    })
  } catch (error: any) {
    console.error("Error in PUT automation:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}













