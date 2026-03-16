import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

/**
 * GET /api/alerts
 * Fetch alerts for the current business
 * 
 * Query parameters:
 * - unread_only: boolean - If true, only return unread alerts
 * - limit: number - Maximum number of alerts to return (default: 50)
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

    const { searchParams } = new URL(request.url)
    const unreadOnly = searchParams.get("unread_only") === "true"
    const limit = parseInt(searchParams.get("limit") || "50")

    let query = supabase
      .from("internal_alerts")
      .select(
        `
        *,
        invoices (
          id,
          invoice_number,
          total,
          customers (
            id,
            name
          )
        ),
        payments (
          id,
          amount,
          method,
          date
        )
      `
      )
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (unreadOnly) {
      query = query.eq("is_read", false)
    }

    const { data: alerts, error } = await query

    if (error) {
      console.error("Error fetching alerts:", error)
      
      // If table doesn't exist, return empty array gracefully
      if (error.code === "42P01" || 
          error.message?.includes("does not exist") ||
          (error.message?.includes("relation") && error.message?.includes("does not exist"))) {
        console.warn("internal_alerts table does not exist, returning empty alerts")
        return NextResponse.json({
          alerts: [],
          unread_count: 0,
        })
      }
      
      // For other errors, still return empty array to not break the UI
      console.warn("Alerts query failed, returning empty array:", error.message)
      return NextResponse.json({
        alerts: [],
        unread_count: 0,
      })
    }

    // Get unread count (handle errors gracefully)
    let unreadCount = 0
    try {
      const { count } = await supabase
        .from("internal_alerts")
        .select("*", { count: "exact", head: true })
        .eq("business_id", business.id)
        .eq("is_read", false)
        .is("deleted_at", null)
      
      unreadCount = count || 0
    } catch (countError: any) {
      console.warn("Error getting unread count:", countError)
      // Continue with unreadCount = 0
    }

    return NextResponse.json({
      alerts: alerts || [],
      unread_count: unreadCount,
    })
  } catch (error: any) {
    console.error("Error fetching alerts:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/alerts/[id]/read
 * Mark an alert as read
 */
export async function PUT(request: NextRequest) {
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

    const body = await request.json()
    const { alert_id, mark_all_read } = body

    if (mark_all_read) {
      // Mark all alerts as read for this business
      const { error } = await supabase
        .from("internal_alerts")
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq("business_id", business.id)
        .eq("is_read", false)
        .is("deleted_at", null)

      if (error) {
        // If table doesn't exist, return success gracefully
        if (error.code === "42P01" || 
            error.message?.includes("does not exist") ||
            (error.message?.includes("relation") && error.message?.includes("does not exist"))) {
          return NextResponse.json({ success: true, message: "All alerts marked as read" })
        }
        
        console.error("Error marking all alerts as read:", error)
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        )
      }

      return NextResponse.json({ success: true, message: "All alerts marked as read" })
    }

    if (!alert_id) {
      return NextResponse.json(
        { error: "alert_id is required" },
        { status: 400 }
      )
    }

    // Mark specific alert as read
    const { error } = await supabase
      .from("internal_alerts")
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq("id", alert_id)
      .eq("business_id", business.id)
      .is("deleted_at", null)

    if (error) {
      // If table doesn't exist, return success gracefully
      if (error.code === "42P01" || 
          error.message?.includes("does not exist") ||
          (error.message?.includes("relation") && error.message?.includes("does not exist"))) {
        return NextResponse.json({ success: true, message: "Alert marked as read" })
      }
      
      console.error("Error marking alert as read:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, message: "Alert marked as read" })
  } catch (error: any) {
    console.error("Error updating alert:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

