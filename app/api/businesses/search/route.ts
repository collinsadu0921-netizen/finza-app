import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

/**
 * GET /api/businesses/search
 * 
 * Searches for businesses by name
 * 
 * Query params:
 *   q: string (search query, minimum 2 characters)
 * 
 * Access: Authenticated users
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

    const { searchParams } = new URL(request.url)
    const query = searchParams.get("q")
    const booksOnly = searchParams.get("books_only") === "true"

    if (!query || query.length < 2) {
      return NextResponse.json({ businesses: [] })
    }

    // Search businesses by name
    let businessesQuery = supabase
      .from("businesses")
      .select("id, name, industry")
      .ilike("name", `%${query}%`)

    if (booksOnly) {
      businessesQuery = businessesQuery.is("industry", null)
    }

    const { data: businesses, error } = await businessesQuery
      .limit(20)
      .order("name", { ascending: true })

    if (error) {
      console.error("Error searching businesses:", error)
      return NextResponse.json(
        { error: "Failed to search businesses" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      businesses: businesses || [],
    })
  } catch (error: any) {
    console.error("Error in business search API:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
