import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveProfessionalVatBusinessId } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { searchParams } = new URL(request.url)
    const urlBusinessId = searchParams.get("business_id")?.trim() || null

    const resolved = await resolveProfessionalVatBusinessId(supabase, user?.id, urlBusinessId)
    if (resolved instanceof NextResponse) return resolved
    const { businessId } = resolved

    const returnsQuery = supabase
      .from("vat_returns")
      .select("*")
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .order("period_start_date", { ascending: false })

    const { data: returns, error } = await returnsQuery

    if (error) {
      console.error("Error fetching VAT returns:", error)
      // If table doesn't exist, return empty array
      if (error.code === "42P01" || error.message?.includes("does not exist")) {
        return NextResponse.json({ returns: [] })
      }
      return NextResponse.json(
        { error: error.message || "Failed to load VAT returns" },
        { status: 500 }
      )
    }

    return NextResponse.json({ returns: returns || [] })
  } catch (error: any) {
    console.error("Error in VAT returns list:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

