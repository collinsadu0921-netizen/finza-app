import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const estimateId = resolvedParams.id

    if (!estimateId) {
      return NextResponse.json({ error: "Quote ID is required" }, { status: 400 })
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const requestedBusinessId =
      (typeof body.business_id === "string" && body.business_id.trim()) ||
      new URL(request.url).searchParams.get("business_id") ||
      undefined
    const scope = await resolveBusinessScopeForUser(supabase, user.id, requestedBusinessId)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const { data: estimate, error: estimateError } = await supabase
      .from("estimates")
      .select("*")
      .eq("id", estimateId)
      .eq("business_id", scope.businessId)
      .is("deleted_at", null)
      .single()

    if (estimateError || !estimate) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 })
    }

    if (estimate.status !== "sent") {
      return NextResponse.json(
        { error: "Only sent quotes can be marked as accepted" },
        { status: 400 }
      )
    }

    const { data: updated, error: updateError } = await supabase
      .from("estimates")
      .update({
        status: "accepted",
        rejected_reason: null,
        rejected_at: null,
      })
      .eq("id", estimateId)
      .select()
      .single()

    if (updateError || !updated) {
      console.error("Error accepting quote (tenant):", updateError)
      return NextResponse.json(
        {
          success: false,
          error: "Quote could not be updated. Please try again.",
          message: updateError?.message,
        },
        { status: 500 }
      )
    }

    await createAuditLog({
      businessId: scope.businessId,
      userId: user?.id || null,
      actionType: "estimate.accepted",
      entityType: "estimate",
      entityId: estimateId,
      oldValues: estimate,
      newValues: updated,
      request,
    })

    return NextResponse.json({
      success: true,
      estimate: updated,
    })
  } catch (error: unknown) {
    console.error("Error accepting quote (tenant):", error)
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json(
      {
        success: false,
        error: "Quote could not be accepted. Please check your connection and try again.",
        message,
      },
      { status: 500 }
    )
  }
}
