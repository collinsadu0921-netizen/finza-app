import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/accounting/firm/requireMember"
import { getEngagementById } from "@/lib/accounting/firm/engagements"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"

/**
 * GET /api/accounting/firm/engagements/[id]
 * 
 * Gets a specific engagement by ID
 * 
 * Access: Users who belong to the firm or business owners
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const engagementId = resolvedParams?.id
    if (!engagementId) {
      return NextResponse.json(
        { error: "Missing engagement id" },
        { status: 400 }
      )
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const forbidden = await requireFirmMemberForApi(supabase, user.id)
    if (forbidden) return forbidden

    const engagement = await getEngagementById(supabase, engagementId)

    if (!engagement) {
      return NextResponse.json(
        { error: "Engagement not found" },
        { status: 404 }
      )
    }

    // Verify user has access (firm user or business owner)
    const { data: firmUser } = await supabase
      .from("accounting_firm_users")
      .select("firm_id")
      .eq("firm_id", engagement.accounting_firm_id)
      .eq("user_id", user.id)
      .maybeSingle()

    const { data: business } = await supabase
      .from("businesses")
      .select("owner_id")
      .eq("id", engagement.client_business_id)
      .maybeSingle()

    const isFirmUser = !!firmUser
    const isBusinessOwner = business?.owner_id === user.id

    if (!isFirmUser && !isBusinessOwner) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      )
    }

    // Get business name
    const { data: businessData } = await supabase
      .from("businesses")
      .select("name")
      .eq("id", engagement.client_business_id)
      .maybeSingle()

    return NextResponse.json({
      engagement: {
        ...engagement,
        business_name: businessData?.name || "Unknown",
      },
    })
  } catch (error: any) {
    console.error("Error in get engagement API:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/accounting/firm/engagements/[id]
 * 
 * Updates engagement status or properties
 * 
 * Request body:
 * {
 *   action: 'suspend' | 'resume' | 'terminate' | 'update'
 *   access_level?: 'read' | 'write' | 'approve' (optional, for updates)
 *   effective_from?: string (optional, for updates)
 *   effective_to?: string | null (optional, for updates)
 * }
 * 
 * Accept/reject: Use Service workspace endpoint /api/service/engagements/[id].
 * This route supports firm authority only: suspend, resume, terminate, update.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const engagementId = resolvedParams?.id
    if (!engagementId) {
      return NextResponse.json(
        { error: "Missing engagement id" },
        { status: 400 }
      )
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const forbidden = await requireFirmMemberForApi(supabase, user.id)
    if (forbidden) return forbidden

    // TEMP FORENSIC (remove after diagnosis): identity only — no cookies/tokens
    const { data: session } = await supabase.auth.getSession()
    console.log("[PATCH_ACCEPT_ID] user.id", user?.id)
    console.log("[PATCH_ACCEPT_ID] session.user.id", session?.session?.user?.id ?? null)
    console.log("[PATCH_ACCEPT_ID] params.id", engagementId)

    const body = (await request.json().catch(() => ({}))) as unknown
    const bodyObj = body as Record<string, unknown>
    const action = typeof bodyObj?.action === "string" ? bodyObj.action : null
    const access_level = bodyObj?.access_level
    const effective_from = bodyObj?.effective_from
    const effective_to = bodyObj?.effective_to

    if (!action) {
      return NextResponse.json(
        { error: "action is required" },
        { status: 400 }
      )
    }

    if (action === "accept" || action === "reject") {
      return NextResponse.json(
        {
          error:
            "Accept and reject must be performed from Service workspace. Use /api/service/engagements/[id].",
        },
        { status: 403 }
      )
    }

    const engagement = await getEngagementById(supabase, engagementId)
    if (!engagement) {
      return NextResponse.json(
        { error: "Engagement not found" },
        { status: 404 }
      )
    }

    // Get user's role in firm
    const { data: firmUser } = await supabase
      .from("accounting_firm_users")
      .select("role")
      .eq("firm_id", engagement.accounting_firm_id)
      .eq("user_id", user.id)
      .maybeSingle()

    // Check if user is business owner
    const { data: business } = await supabase
      .from("businesses")
      .select("owner_id")
      .eq("id", engagement.client_business_id)
      .maybeSingle()

    const isBusinessOwner = business?.owner_id === user.id
    const isPartner = firmUser?.role === "partner"
    const isSenior = firmUser?.role === "senior"

    // Determine new status based on action
    let newStatus: string | null = null
    const updateData: Record<string, unknown> = {}
    let actionType: string | undefined

    switch (action) {
      case "suspend":
        if (!isPartner && !isSenior) {
          return NextResponse.json(
            { error: "Only Partners and Seniors can suspend engagements" },
            { status: 403 }
          )
        }
        if (engagement.status !== "active" && engagement.status !== "accepted") {
          return NextResponse.json(
            { error: "Only effective (accepted/active) engagements can be suspended" },
            { status: 400 }
          )
        }
        newStatus = "suspended"
        actionType = "engagement_suspended"
        break

      case "resume":
        if (!isPartner && !isSenior) {
          return NextResponse.json(
            { error: "Only Partners and Seniors can resume engagements" },
            { status: 403 }
          )
        }
        if (engagement.status !== "suspended") {
          return NextResponse.json(
            { error: "Only suspended engagements can be resumed" },
            { status: 400 }
          )
        }
        newStatus = "accepted"
        actionType = "engagement_resumed"
        break

      case "terminate":
        // Use canonical authority resolver
        const { resolveAuthority: resolveTerminateAuthority } = await import("@/lib/accounting/firm/authority")
        const terminateAuthority = resolveTerminateAuthority({
          firmRole: firmUser?.role as any || null,
          engagementAccess: engagement.access_level as any,
          action: "terminate_engagement",
          engagementStatus: engagement.status as any,
        })

        if (!terminateAuthority.allowed) {
          const logModule = await import("@/lib/accounting/firm/activityLog") as typeof import("@/lib/accounting/firm/activityLog") & {
            logBlockedActionAttempt?: (supabase: unknown, firmId: string, userId: string, actionType: string, reasonCode: string, _reqAccess?: string, _reqRole?: string, businessId?: string) => Promise<unknown>
          }
          if (logModule.logBlockedActionAttempt) {
            await logModule.logBlockedActionAttempt(
              supabase,
              engagement.accounting_firm_id,
              user.id,
              "terminate_engagement",
              terminateAuthority.reasonCode ?? "UNKNOWN",
              undefined,
              undefined,
              engagement.client_business_id
            )
          }

          return NextResponse.json(
            { error: terminateAuthority.reason || "Insufficient authority" },
            { status: 403 }
          )
        }

        if (engagement.status === "terminated") {
          return NextResponse.json(
            { error: "Engagement is already terminated" },
            { status: 400 }
          )
        }
        newStatus = "terminated"
        actionType = "engagement_terminated"
        break

      case "update":
        // Use canonical authority resolver (update_engagement = Partner only, same as change_engagement_access intent)
        const { resolveAuthority: resolveUpdateAuthority } = await import("@/lib/accounting/firm/authority")
        const updateAuthority = resolveUpdateAuthority({
          firmRole: (firmUser?.role as "partner" | "senior" | "junior" | "readonly") || null,
          engagementAccess: engagement.access_level as "read" | "write" | "approve",
          action: "update_engagement",
          engagementStatus: engagement.status as "pending" | "active" | "suspended" | "terminated" | null,
        })

        if (!updateAuthority.allowed) {
          const logModuleUpdate = await import("@/lib/accounting/firm/activityLog") as typeof import("@/lib/accounting/firm/activityLog") & {
            logBlockedActionAttempt?: (supabase: unknown, firmId: string, userId: string, actionType: string, reasonCode: string, _reqAccess?: string, _reqRole?: string, businessId?: string) => Promise<unknown>
          }
          if (logModuleUpdate.logBlockedActionAttempt) {
            await logModuleUpdate.logBlockedActionAttempt(
              supabase,
              engagement.accounting_firm_id,
              user.id,
              "update_engagement",
              updateAuthority.reasonCode ?? "UNKNOWN",
              undefined,
              undefined,
              engagement.client_business_id
            )
          }

          return NextResponse.json(
            { error: updateAuthority.reason || "Insufficient authority" },
            { status: 403 }
          )
        }
        if (access_level) {
          updateData.access_level = access_level
          actionType = "engagement_access_level_changed"
        }
        if (effective_from) {
          updateData.effective_from = effective_from
          actionType = "engagement_effective_date_changed"
        }
        if (effective_to !== undefined) {
          updateData.effective_to = effective_to
          actionType = "engagement_effective_date_changed"
        }
        break

      default:
        return NextResponse.json(
          { error: `Invalid action: ${action}` },
          { status: 400 }
        )
    }

    if (newStatus) {
      updateData.status = newStatus
    }

    // TRACK B2: EXCEPTION - Writing to operational table 'firm_client_engagements'
    // This is an intentional boundary crossing: Accounting workspace requires the ability
    // to update firm-client engagements (status, access_level, effective dates) as part
    // of engagement management. This exception enables the Accountant-First model where
    // accounting firms manage their client relationships. This write is explicitly allowed and guarded.
    // See ACCOUNTING_WRITE_TARGETS_CLASSIFICATION.md for exception documentation.
    const { data: updatedEngagement, error: updateError } = await supabase
      .from("firm_client_engagements")
      .update(updateData)
      .eq("id", engagementId)
      .select()
      .single()

    if (updateError) {
      console.error("Error updating engagement:", {
        engagementId,
        action,
        code: updateError.code,
        message: updateError.message,
        hint: updateError.hint,
        details: updateError.details,
      })
      const isZeroRows =
        updateError.code === "PGRST116" || (updateError.message || "").toLowerCase().includes("row")
      if (isZeroRows) {
        console.warn(
          "[engagement PATCH] Update affected 0 rows — possible RLS policy or constraint/trigger rejection. engagementId=%s action=%s",
          engagementId,
          action
        )
      }
      return NextResponse.json(
        { error: "Failed to update engagement" },
        { status: 500 }
      )
    }

    if (!updatedEngagement) {
      console.warn(
        "[engagement PATCH] UPDATE succeeded but no row returned (0 rows affected). engagementId=%s action=%s",
        engagementId,
        action
      )
      return NextResponse.json(
        { error: "Engagement not found after update" },
        { status: 404 }
      )
    }

    // Log activity
    if (actionType) {
      await logFirmActivity({
        supabase,
        firmId: engagement.accounting_firm_id,
        actorUserId: user.id,
        actionType: actionType as any,
        entityType: "engagement",
        entityId: engagementId,
        metadata: {
          previous_status: engagement.status,
          new_status: newStatus || engagement.status,
          access_level: access_level || engagement.access_level,
          effective_from: effective_from || engagement.effective_from,
          effective_to: effective_to !== undefined ? effective_to : engagement.effective_to,
        },
      })
    }

    return NextResponse.json({
      success: true,
      engagement: updatedEngagement,
    })
  } catch (error: unknown) {
    console.error("Error in update engagement API:", error)
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
