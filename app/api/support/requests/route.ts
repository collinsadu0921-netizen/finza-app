import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { validateSupportRequestInput } from "@/lib/support/supportRequestValidation"
import { notifyInternalSupportRequest } from "@/lib/support/notifySupportRequest"

export const dynamic = "force-dynamic"

const LIST_LIMIT = 20

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
    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      searchParams.get("business_id") ?? searchParams.get("businessId")
    )

    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const limitRaw = parseInt(searchParams.get("limit") || String(LIST_LIMIT), 10)
    const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : LIST_LIMIT))

    const { data, error } = await supabase
      .from("support_requests")
      .select(
        "id, category, subject, message, urgency, status, route, created_at, updated_at, resolved_at"
      )
      .eq("business_id", scope.businessId)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (error) {
      console.error("support_requests list error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ requests: data ?? [] })
  } catch (err: unknown) {
    console.error("GET /api/support/requests:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const validated = validateSupportRequestInput(body)
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }

    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      typeof body.business_id === "string"
        ? body.business_id
        : typeof body.businessId === "string"
          ? body.businessId
          : null
    )

    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const route =
      typeof body.route === "string" && body.route.trim()
        ? body.route.trim().slice(0, 500)
        : null
    const userAgent =
      typeof body.user_agent === "string" && body.user_agent.trim()
        ? body.user_agent.trim().slice(0, 500)
        : request.headers.get("user-agent")?.slice(0, 500) ?? null

    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : {}

    const { data: inserted, error: insertError } = await supabase
      .from("support_requests")
      .insert({
        business_id: scope.businessId,
        user_id: user.id,
        category: validated.data.category,
        subject: validated.data.subject,
        message: validated.data.message,
        urgency: validated.data.urgency,
        route,
        user_agent: userAgent,
        metadata,
        status: "open",
      })
      .select("id, category, subject, urgency, status, created_at")
      .single()

    if (insertError || !inserted) {
      console.error("support_requests insert error:", insertError)
      return NextResponse.json(
        { error: insertError?.message || "Could not submit support request" },
        { status: 500 }
      )
    }

    const { data: businessRow } = await supabase
      .from("businesses")
      .select("name, trading_name, legal_name")
      .eq("id", scope.businessId)
      .maybeSingle()

    const businessName =
      businessRow?.trading_name?.trim() ||
      businessRow?.legal_name?.trim() ||
      businessRow?.name?.trim() ||
      null

    notifyInternalSupportRequest({
      requestId: inserted.id,
      businessId: scope.businessId,
      businessName,
      userEmail: user.email ?? null,
      userId: user.id,
      category: validated.data.category,
      urgency: validated.data.urgency,
      subject: validated.data.subject,
      message: validated.data.message,
      route,
    }).catch((err) => {
      console.warn("[support] notification failed:", err instanceof Error ? err.message : err)
    })

    return NextResponse.json({ success: true, request: inserted })
  } catch (err: unknown) {
    console.error("POST /api/support/requests:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    )
  }
}
