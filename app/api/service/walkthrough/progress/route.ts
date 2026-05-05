import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

async function userCanAccessBusiness(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  businessId: string
): Promise<boolean> {
  const { data: b, error } = await supabase
    .from("businesses")
    .select("id, owner_id")
    .eq("id", businessId)
    .is("archived_at", null)
    .maybeSingle()
  if (error || !b) return false
  if (b.owner_id === userId) return true
  const { data: m } = await supabase
    .from("business_users")
    .select("id")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle()
  return Boolean(m)
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const businessId = request.nextUrl.searchParams.get("business_id")?.trim() ?? ""
    if (!businessId) {
      return NextResponse.json({ error: "business_id is required" }, { status: 400 })
    }

    const ok = await userCanAccessBusiness(supabase, user.id, businessId)
    if (!ok) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data, error } = await supabase
      .from("service_walkthrough_progress")
      .select("tour_key, tour_version, status, updated_at")
      .eq("business_id", businessId)
      .eq("user_id", user.id)

    if (error) {
      console.error("[walkthrough/progress] GET", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ rows: data ?? [] })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error"
    console.error("[walkthrough/progress] GET", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

const PostBodySchema = z.object({
  business_id: z.string().uuid(),
  tour_key: z.string().min(1).max(200),
  tour_version: z.number().int().min(1).max(1000),
  status: z.enum(["completed", "skipped"]),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let json: unknown
    try {
      json = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    const parsed = PostBodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 })
    }

    const { business_id, tour_key, tour_version, status } = parsed.data

    const ok = await userCanAccessBusiness(supabase, user.id, business_id)
    if (!ok) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const now = new Date().toISOString()
    const row = {
      user_id: user.id,
      business_id,
      tour_key,
      tour_version,
      status,
      updated_at: now,
      completed_at: status === "completed" ? now : null,
      skipped_at: status === "skipped" ? now : null,
    }

    const { error } = await supabase.from("service_walkthrough_progress").upsert(row, {
      onConflict: "user_id,business_id,tour_key",
    })

    if (error) {
      console.error("[walkthrough/progress] POST upsert", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error"
    console.error("[walkthrough/progress] POST", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
