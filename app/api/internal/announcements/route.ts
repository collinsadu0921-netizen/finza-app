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
 * GET /api/internal/announcements — list all (newest first)
 * POST /api/internal/announcements — create draft/active row
 */
export async function GET() {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user?.email || !isInternalAnnouncementAdminEmail(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const admin = getSupabaseServiceRoleClient()
    if (!admin) {
      return NextResponse.json(
        { error: "Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing" },
        { status: 500 }
      )
    }

    const { data, error } = await admin
      .from("platform_announcements")
      .select("*")
      .order("updated_at", { ascending: false })

    if (error) {
      console.error("[internal/announcements GET]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ announcements: data ?? [] })
  } catch (e: unknown) {
    console.error("[internal/announcements GET]", e)
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user?.id || !user.email || !isInternalAnnouncementAdminEmail(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const admin = getSupabaseServiceRoleClient()
    if (!admin) {
      return NextResponse.json(
        { error: "Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing" },
        { status: 500 }
      )
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const title = String((body as Record<string, unknown>).title ?? "").trim()
    const rawBody = String((body as Record<string, unknown>).body ?? "").trim()
    if (!title || !rawBody) {
      return NextResponse.json({ error: "title and body are required" }, { status: 400 })
    }

    let status: PlatformAnnouncementStatus = "draft"
    let severity: PlatformAnnouncementSeverity = "info"
    let placement: PlatformAnnouncementPlacement = "global_banner"
    let audience: PlatformAnnouncementAudienceScope = "all_tenants"
    try {
      if ((body as Record<string, unknown>).status != null) {
        status = assertEnum((body as Record<string, unknown>).status, STATUSES, "status")
      }
      if ((body as Record<string, unknown>).severity != null) {
        severity = assertEnum((body as Record<string, unknown>).severity, SEVERITIES, "severity")
      }
      if ((body as Record<string, unknown>).placement != null) {
        placement = assertEnum((body as Record<string, unknown>).placement, PLACEMENTS, "placement")
      }
      if ((body as Record<string, unknown>).audience_scope != null) {
        audience = assertEnum((body as Record<string, unknown>).audience_scope, AUDIENCES, "audience_scope")
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid field"
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    const dismissible = Boolean((body as Record<string, unknown>).dismissible ?? true)
    const start_at =
      (body as Record<string, unknown>).start_at == null || (body as Record<string, unknown>).start_at === ""
        ? null
        : String((body as Record<string, unknown>).start_at)
    const end_at =
      (body as Record<string, unknown>).end_at == null || (body as Record<string, unknown>).end_at === ""
        ? null
        : String((body as Record<string, unknown>).end_at)

    const { data, error } = await admin
      .from("platform_announcements")
      .insert({
        title,
        body: rawBody,
        status,
        severity,
        placement,
        audience_scope: audience,
        dismissible,
        start_at,
        end_at,
        created_by: user.id,
      })
      .select("*")
      .single()

    if (error) {
      console.error("[internal/announcements POST]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ announcement: data })
  } catch (e: unknown) {
    console.error("[internal/announcements POST]", e)
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 })
  }
}
