import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { filterAnnouncementsForTenantContext, isAnnouncementActiveForDisplay } from "@/lib/platform/announcementsServer"
import type { PlatformAnnouncementRow } from "@/lib/platform/announcementsTypes"

/**
 * GET /api/platform/announcements/active
 * Query: pathname (required for audience routing), businessIndustry (optional, for "core" surface)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const admin = getSupabaseServiceRoleClient()
    if (!admin) {
      return NextResponse.json({ announcements: [] })
    }

    const { searchParams } = new URL(request.url)
    const pathname = searchParams.get("pathname") || "/"
    const businessIndustry = searchParams.get("businessIndustry")

    const { data: rows, error } = await admin.from("platform_announcements").select("*").eq("status", "active")

    if (error) {
      console.error("[platform/announcements/active]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const activeRows = (rows ?? []).filter((r) =>
      isAnnouncementActiveForDisplay(r as PlatformAnnouncementRow)
    ) as PlatformAnnouncementRow[]

    const { data: dismissRows, error: dismissError } = await admin
      .from("platform_announcement_dismissals")
      .select("announcement_id")
      .eq("user_id", user.id)

    if (dismissError) {
      console.error("[platform/announcements/active] dismissals", dismissError)
    }

    const dismissedIds = new Set(
      (dismissRows ?? []).map((d: { announcement_id: string }) => d.announcement_id).filter(Boolean)
    )

    const announcements = filterAnnouncementsForTenantContext(activeRows, {
      pathname,
      businessIndustry,
      dismissedIds,
    })

    return NextResponse.json({ announcements })
  } catch (e: unknown) {
    console.error("[platform/announcements/active]", e)
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 })
  }
}
