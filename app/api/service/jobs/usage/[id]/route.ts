import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

const ALLOWED_STATUSES = ["allocated", "consumed", "returned"] as const

/**
 * PATCH /api/service/jobs/usage/[id]
 * Update usage status. Only allocated -> consumed posts to ledger (DB trigger).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: usageId } = await params
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

    const body = await request.json().catch(() => ({}))
    const { status } = body as { status?: string }

    if (!status || !ALLOWED_STATUSES.includes(status as (typeof ALLOWED_STATUSES)[number])) {
      return NextResponse.json(
        { error: "status must be one of: allocated, consumed, returned" },
        { status: 400 }
      )
    }

    const { data: existing, error: fetchErr } = await supabase
      .from("service_job_material_usage")
      .select("id, business_id, status")
      .eq("id", usageId)
      .eq("business_id", business.id)
      .single()

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Usage record not found" }, { status: 404 })
    }

    const currentStatus = existing.status as string
    if (currentStatus === "consumed") {
      return NextResponse.json(
        { error: "Already consumed; cannot change status" },
        { status: 400 }
      )
    }
    if (currentStatus === "returned") {
      return NextResponse.json(
        { error: "Already returned; cannot change status" },
        { status: 400 }
      )
    }

    const { error: updateErr } = await supabase
      .from("service_job_material_usage")
      .update({ status })
      .eq("id", usageId)
      .eq("business_id", business.id)

    if (updateErr) {
      console.error("Usage status update error:", updateErr)
      return NextResponse.json({ error: "Failed to update status" }, { status: 500 })
    }

    return NextResponse.json({ success: true, status })
  } catch (err: unknown) {
    console.error("Usage status error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
