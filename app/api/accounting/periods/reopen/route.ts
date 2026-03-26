import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getUserRole } from "@/lib/userRoles"
import { logAudit } from "@/lib/auditLog"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { checkFirmOnboardingForAction } from "@/lib/accounting/firm/onboarding"
import { getActiveEngagement, isEngagementEffective } from "@/lib/accounting/firm/engagements"
import { resolveAuthority } from "@/lib/accounting/firm/authority"
import { logBlockedActionAttempt } from "@/lib/accounting/firm/activityLog"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { business_id, period_start, reason } = body

    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Forbidden"
      return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
    }

    // Validate required fields
    if (!business_id || !period_start || !reason) {
      return NextResponse.json(
        { error: "Missing required fields: business_id, period_start, reason" },
        { status: 400 }
      )
    }

    const resolved = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams: new URLSearchParams({ business_id: String(business_id) }),
      pathname: new URL(request.url).pathname,
      source: "api",
    })
    if ("error" in resolved) {
      return NextResponse.json(
        { error: "Missing required fields: business_id, period_start, reason" },
        { status: 400 }
      )
    }
    const resolvedBusinessId = resolved.businessId

    // Validate reason is non-empty and minimum length
    const reasonTrimmed = typeof reason === "string" ? reason.trim() : ""
    if (reasonTrimmed.length === 0) {
      return NextResponse.json(
        { error: "Reason is required and cannot be empty" },
        { status: 400 }
      )
    }
    if (reasonTrimmed.length < 10) {
      return NextResponse.json(
        { error: "Reason must be at least 10 characters" },
        { status: 400 }
      )
    }

    // Validate period_start format (YYYY-MM-01)
    const periodStartDate = new Date(period_start)
    if (isNaN(periodStartDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid period_start format. Must be YYYY-MM-01" },
        { status: 400 }
      )
    }

    // Verify period_start is first day of month
    const expectedFirstDay = new Date(
      periodStartDate.getFullYear(),
      periodStartDate.getMonth(),
      1
    )
    if (periodStartDate.getTime() !== expectedFirstDay.getTime()) {
      return NextResponse.json(
        { error: "period_start must be the first day of the month (YYYY-MM-01)" },
        { status: 400 }
      )
    }

    const authResult = await checkAccountingAuthority(supabase, user.id, resolvedBusinessId, "write")
    if (!authResult.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Only accountants with write access can reopen periods." },
        { status: 403 }
      )
    }

    const onboardingCheck = await checkFirmOnboardingForAction(
      supabase,
      user.id,
      resolvedBusinessId
    )

    // Role checks for reopen_period (partner etc.) when user is firm user
    if (onboardingCheck.firmId) {
      // Get user's firm role
      const { data: firmUser } = await supabase
        .from("accounting_firm_users")
        .select("role")
        .eq("firm_id", onboardingCheck.firmId)
        .eq("user_id", user.id)
        .maybeSingle()

      // Get active engagement
      const engagement = await getActiveEngagement(
        supabase,
        onboardingCheck.firmId,
        resolvedBusinessId
      )

      // Check if engagement is effective
      if (engagement && !isEngagementEffective(engagement)) {
        const today = new Date().toISOString().split("T")[0]
        if (engagement.effective_from > today) {
          return NextResponse.json(
            { error: `Engagement is not yet effective. Effective date: ${engagement.effective_from}` },
            { status: 403 }
          )
        }
        if (engagement.effective_to && engagement.effective_to < today) {
          return NextResponse.json(
            { error: `Engagement has expired. Expired on: ${engagement.effective_to}` },
            { status: 403 }
          )
        }
      }

      // Resolve authority using canonical resolver
      const authority = resolveAuthority({
        firmRole: firmUser?.role as any || null,
        engagementAccess: engagement?.access_level as any || null,
        action: "reopen_period",
        engagementStatus: engagement?.status as any || null,
      })

      if (!authority.allowed) {
        // Log blocked action attempt
        await logBlockedActionAttempt(
          supabase,
          onboardingCheck.firmId,
          user.id,
          "reopen_period",
          authority.reasonCode!,
          authority.requiredEngagementAccess,
          authority.requiredFirmRole,
          resolvedBusinessId
        )

        return NextResponse.json(
          { error: authority.reason || "Insufficient authority" },
          { status: 403 }
        )
      }
    } else {
      // For business owners (not firm users), check admin/owner role
      const userRole = await getUserRole(supabase, user.id, resolvedBusinessId)

      if (!userRole) {
        return NextResponse.json(
          { error: "Unauthorized. User role not found." },
          { status: 403 }
        )
      }

      // Only admin or owner can reopen periods (business owner path)
      if (userRole !== "admin" && userRole !== "owner") {
        return NextResponse.json(
          { error: "Unauthorized. Only admins or owners can reopen periods." },
          { status: 403 }
        )
      }
    }

    // Get the period
    const { data: period, error: periodError } = await supabase
      .from("accounting_periods")
      .select("*")
      .eq("business_id", resolvedBusinessId)
      .eq("period_start", period_start)
      .single()

    if (periodError || !period) {
      return NextResponse.json(
        { error: "Accounting period not found" },
        { status: 404 }
      )
    }

    // Validate status: Only soft_closed can be reopened
    if (period.status !== "soft_closed") {
      if (period.status === "locked") {
        return NextResponse.json(
          { error: "Cannot reopen locked period. Locked periods are immutable." },
          { status: 400 }
        )
      }
      return NextResponse.json(
        { error: `Cannot reopen period with status '${period.status}'. Only 'soft_closed' periods can be reopened.` },
        { status: 400 }
      )
    }

    // Update the period: soft_closed → open
    // Clear closed_at and closed_by when reopening
    const { data: updatedPeriod, error: updateError } = await supabase
      .from("accounting_periods")
      .update({
        status: "open",
        closed_at: null,
        closed_by: null,
      })
      .eq("id", period.id)
      .select()
      .single()

    if (updateError) {
      console.error("Error updating accounting period:", updateError)
      return NextResponse.json(
        { error: updateError.message || "Failed to reopen period" },
        { status: 500 }
      )
    }

    // Create audit record with reason (REQUIRED for reopen)
    const { error: auditError } = await supabase
      .from("accounting_period_actions")
      .insert({
        business_id: resolvedBusinessId,
        period_start: period_start,
        action: "reopen",
        performed_by: user.id,
        performed_at: new Date().toISOString(),
        reason: reasonTrimmed,
      })

    if (auditError) {
      console.error("Error creating audit record:", auditError)
      // CRITICAL: If audit fails, rollback the period status change
      // Restore original status
      await supabase
        .from("accounting_periods")
        .update({
          status: "soft_closed",
          closed_at: period.closed_at,
          closed_by: period.closed_by,
        })
        .eq("id", period.id)

      return NextResponse.json(
        { error: "Failed to create audit record. Period was not reopened." },
        { status: 500 }
      )
    }

    await logAudit({
      businessId: resolvedBusinessId,
      userId: user.id,
      actionType: "period_reopen",
      entityType: "period",
      entityId: period.id,
      description: reasonTrimmed,
      newValues: { period_id: period.id, reopened_by: user.id },
      request,
    })

    return NextResponse.json({
      success: true,
      period: updatedPeriod,
    })
  } catch (error: any) {
    console.error("Error in period reopen:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
