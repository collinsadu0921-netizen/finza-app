import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { isInternalAnnouncementAdminEmail } from "@/lib/internalAnnouncementsAdmin"
import type {
  PlatformAnnouncementAudienceScope,
  PlatformAnnouncementPlacement,
  PlatformAnnouncementSeverity,
  PlatformAnnouncementStatus,
} from "@/lib/platform/announcementsTypes"

const STATUSES: PlatformAnnouncementStatus[] = ["draft", "active", "archived"]
const SEVERITIES: PlatformAnnouncementSeverity[] = ["info", "success", "warning", "critical"]
const PLACEMENTS: PlatformAnnouncementPlacement[] = ["global_banner", "dashboard_card", "modal"]
const AUDIENCES: PlatformAnnouncementAudienceScope[] = [
  "all_tenants",
  "service_workspace_only",
  "retail_workspace_only",
  "accounting_workspace_only",
]

function assertEnum<T extends string>(val: unknown, allowed: readonly T[], label: string): T {
  if (typeof val !== "string" || !allowed.includes(val as T)) {
    throw new Error(`Invalid ${label}`)
  }
  return val as T
}

/**
 * GET /api/internal/announcements/[id]
 * PATCH /api/internal/announcements/[id] — partial update
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user?.email || !isInternalAnnouncementAdminEmail(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const admin = getSupabaseServiceRoleClient()
    if (!admin) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
    }

    const { data, error } = await admin.from("platform_announcements").select("*").eq("id", id).maybeSingle()
    if (error) {
      console.error("[internal/announcements/[id] GET]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ announcement: data })
  } catch (e: unknown) {
    console.error("[internal/announcements/[id] GET]", e)
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user?.email || !isInternalAnnouncementAdminEmail(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const admin = getSupabaseServiceRoleClient()
    if (!admin) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const patch: Record<string, unknown> = {}

    if ("title" in body) patch.title = String((body as Record<string, unknown>).title ?? "").trim()
    if ("body" in body) patch.body = String((body as Record<string, unknown>).body ?? "").trim()
    if ("dismissible" in body) patch.dismissible = Boolean((body as Record<string, unknown>).dismissible)

    if ("start_at" in body) {
      const v = (body as Record<string, unknown>).start_at
      patch.start_at = v == null || v === "" ? null : String(v)
    }
    if ("end_at" in body) {
      const v = (body as Record<string, unknown>).end_at
      patch.end_at = v == null || v === "" ? null : String(v)
    }

    try {
      if ("status" in body && (body as Record<string, unknown>).status != null) {
        patch.status = assertEnum((body as Record<string, unknown>).status, STATUSES, "status")
      }
      if ("severity" in body && (body as Record<string, unknown>).severity != null) {
        patch.severity = assertEnum((body as Record<string, unknown>).severity, SEVERITIES, "severity")
      }
      if ("placement" in body && (body as Record<string, unknown>).placement != null) {
        patch.placement = assertEnum((body as Record<string, unknown>).placement, PLACEMENTS, "placement")
      }
      if ("audience_scope" in body && (body as Record<string, unknown>).audience_scope != null) {
        patch.audience_scope = assertEnum(
          (body as Record<string, unknown>).audience_scope,
          AUDIENCES,
          "audience_scope"
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid field"
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    if ("title" in patch && !patch.title) {
      return NextResponse.json({ error: "title cannot be empty" }, { status: 400 })
    }
    if ("body" in patch && !patch.body) {
      return NextResponse.json({ error: "body cannot be empty" }, { status: 400 })
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
    }

    const { data, error } = await admin
      .from("platform_announcements")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle()

    if (error) {
      console.error("[internal/announcements/[id] PATCH]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ announcement: data })
  } catch (e: unknown) {
    console.error("[internal/announcements/[id] PATCH]", e)
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 })
  }
}
