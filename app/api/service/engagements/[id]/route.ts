/**
 * PATCH /api/service/engagements/[id]
 *
 * Service workspace endpoint for Accept/Reject engagement only.
 * Fetches engagement by id only; validates ownership using engagement.client_business_id.
 * No business context resolver — invitations decide visibility; this route trusts the row.
 *
 * Allowed actions: accept, reject
 * Accounting workspace owns: suspend, resume, terminate, update
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { logFirmActivity } from "@/lib/firmActivityLog"

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await Promise.resolve(context.params)
    const engagementId = resolvedParams.id
    if (!engagementId) {
      console.error("[ENG_PATCH] Missing engagementId param")
      return NextResponse.json(
        { error: "Invalid engagement id" },
        { status: 400 }
      )
    }
    const { data: session } = await supabase.auth.getSession()
    console.log("[ENG_PATCH]", {
      paramsId: engagementId,
      userId: user?.id ?? null,
      sessionUserId: session?.session?.user?.id ?? null,
    })

    const body = await request.json().catch(() => ({}))
    const action = body?.action

    if (!action || (action !== "accept" && action !== "reject")) {
      return NextResponse.json(
        { error: "Only accept or reject is allowed from Service workspace" },
        { status: 400 }
      )
    }

    const { data: engagement, error: fetchError } = await supabase
      .from("firm_client_engagements")
      .select("*")
      .eq("id", engagementId)
      .maybeSingle()

    console.log("[ENG_PATCH] select by id", {
      rowReturned: engagement != null,
      errorCode: fetchError?.code ?? null,
      errorMessage: fetchError?.message ?? null,
    })

    if (fetchError || !engagement) {
      return NextResponse.json(
        { error: "Engagement not found" },
        { status: 404 }
      )
    }

    const { data: business } = await supabase
      .from("businesses")
      .select("owner_id")
      .eq("id", engagement.client_business_id)
      .maybeSingle()

    if (business?.owner_id !== user.id) {
      return NextResponse.json(
        { error: "Only business owners can accept or reject engagements" },
        { status: 403 }
      )
    }

    if (engagement.status !== "pending") {
      return NextResponse.json(
        {
          error:
            action === "accept"
              ? "Only pending engagements can be accepted"
              : "Only pending engagements can be rejected",
        },
        { status: 400 }
      )
    }

    let updateData: Record<string, unknown>
    let actionType: string

    if (action === "accept") {
      updateData = {
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_by: user.id,
      }
      actionType = "engagement_accepted"
    } else {
      updateData = { status: "terminated" }
      actionType = "engagement_rejected"
    }

    const { data: updatedEngagement, error: updateError } = await supabase
      .from("firm_client_engagements")
      .update(updateData)
      .eq("id", engagementId)
      .select()
      .single()

    if (updateError) {
      console.error("Error updating engagement (service):", {
        engagementId,
        action,
        code: updateError.code,
        message: updateError.message,
      })
      return NextResponse.json(
        { error: "Failed to update engagement" },
        { status: 500 }
      )
    }

    if (!updatedEngagement) {
      return NextResponse.json(
        { error: "Engagement not found after update" },
        { status: 404 }
      )
    }

    await logFirmActivity({
      supabase,
      firmId: engagement.accounting_firm_id,
      actorUserId: user.id,
      actionType,
      entityType: "engagement",
      entityId: engagementId,
      metadata: {
        previous_status: engagement.status,
        new_status: updateData.status as string,
      },
    })

    return NextResponse.json({
      success: true,
      engagement: updatedEngagement,
    })
  } catch (error: unknown) {
    console.error("Error in service engagement PATCH:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
