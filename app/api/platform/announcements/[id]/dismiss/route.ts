import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { isAnnouncementActiveForDisplay } from "@/lib/platform/announcementsServer"
import type { PlatformAnnouncementRow } from "@/lib/platform/announcementsTypes"

/**
 * POST /api/platform/announcements/[id]/dismiss
 * Records a per-user dismissal for a dismissible, active announcement.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const admin = getSupabaseServiceRoleClient()
    if (!admin) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 503 })
    }

    const { data: row, error: fetchError } = await admin
      .from("platform_announcements")
      .select("*")
      .eq("id", id)
      .maybeSingle()

    if (fetchError) {
      console.error("[dismiss] fetch", fetchError)
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const ann = row as PlatformAnnouncementRow
    if (!isAnnouncementActiveForDisplay(ann)) {
      return NextResponse.json({ error: "Announcement is not active" }, { status: 400 })
    }
    if (!ann.dismissible) {
      return NextResponse.json({ error: "This announcement cannot be dismissed" }, { status: 400 })
    }

    const { error: insError } = await admin.from("platform_announcement_dismissals").insert({
      announcement_id: id,
      user_id: user.id,
      dismissed_at: new Date().toISOString(),
    })

    if (insError) {
      if (insError.code === "23505") {
        return NextResponse.json({ ok: true, duplicate: true })
      }
      console.error("[dismiss] insert", insError)
      return NextResponse.json({ error: insError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    console.error("[dismiss]", e)
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 })
  }
}
