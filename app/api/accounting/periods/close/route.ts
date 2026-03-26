import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
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
    const { business_id, period_start, action } = body

    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Forbidden"
      return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
    }

    // Validate required fields
    if (!business_id || !period_start || !action) {
      return NextResponse.json(
        { error: "Missing required fields: business_id, period_start, action" },
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
        { error: "Missing required fields: business_id, period_start, action" },
        { status: 400 }
      )
    }
    const resolvedBusinessId = resolved.businessId

    // Validate action
    if (!["soft_close", "lock", "request_close", "approve_close", "reject_close"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Must be 'soft_close', 'lock', 'request_close', 'approve_close', or 'reject_close'" },
        { status: 400 }
      )
    }

    // Validate period_start format (YYYY-MM-01) — string check to avoid timezone issues
    if (!/^\d{4}-\d{2}-01$/.test(period_start)) {
      return NextResponse.json(
        { error: "period_start must be the first day of the month (YYYY-MM-01)" },
        { status: 400 }
      )
    }
    const periodStartDate = new Date(period_start)
    if (isNaN(periodStartDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid period_start format. Must be YYYY-MM-01" },
        { status: 400 }
      )
    }

    const authResult = await checkAccountingAuthority(supabase, user.id, resolvedBusinessId, "write")
    if (!authResult.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Only accountants with write access can close or lock periods." },
        { status: 403 }
      )
    }

    const onboardingCheck = await checkFirmOnboardingForAction(
      supabase,
      user.id,
      resolvedBusinessId
    )

    // Role checks for close_period (partner etc.) via resolveAuthority when user is firm user
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

      // Resolve authority based on action type
      let actionName = "close_period"
      if (action === "request_close") {
        actionName = "request_close_period"
      } else if (action === "approve_close") {
        actionName = "approve_close_period"
      } else if (action === "reject_close") {
        actionName = "reject_close_period"
      }

      const authority = resolveAuthority({
        firmRole: firmUser?.role as any || null,
        engagementAccess: engagement?.access_level as any || null,
        action: actionName as import("@/lib/accounting/firm/authority").ActionType,
        engagementStatus: engagement?.status as any || null,
      })

      if (!authority.allowed) {
        // Log blocked action attempt
        await logBlockedActionAttempt(
          supabase,
          onboardingCheck.firmId,
          user.id,
          actionName,
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

    // Run pre-close audit checks and log attempt (for any close action)
    const runAndLogCloseChecks = async (): Promise<{ ok: boolean; failures: Array<{ code: string; title: string; detail: string }> }> => {
      const { data: checks, error: checksErr } = await supabase.rpc("run_period_close_checks", {
        p_business_id: resolvedBusinessId,
        p_period_id: period.id,
      })
      if (checksErr) {
        console.error("run_period_close_checks error:", checksErr)
        return { ok: false, failures: [{ code: "CHECK_ERROR", title: "Pre-close checks failed", detail: checksErr.message }] }
      }
      const result = checks as { ok: boolean; failures: Array<{ code: string; title: string; detail: string }> }
      await supabase.from("period_close_attempts").insert({
          business_id: resolvedBusinessId,
        period_id: period.id,
        performed_by: user.id,
        performed_at: new Date().toISOString(),
        checks_passed: result.ok === true,
        failures: result.failures ?? [],
      })
      return result
    }

    // Handle new workflow actions (request_close, approve_close, reject_close)
    if (action === "request_close") {
      // Request close: open → closing
      if (period.status !== "open") {
        return NextResponse.json(
          { error: "request_close is only allowed when status is 'open'" },
          { status: 400 }
        )
      }

      // Check for active close request
      if (period.close_requested_at) {
        return NextResponse.json(
          { error: "A close request is already pending for this period" },
          { status: 400 }
        )
      }

      // Check readiness (must have no blockers)
      const { data: readiness, error: readinessError } = await supabase.rpc(
        "check_period_close_readiness",
        {
          p_business_id: resolvedBusinessId,
          p_period_start: period_start,
        }
      )

      if (readinessError) {
        console.error("Error checking readiness:", readinessError)
        return NextResponse.json(
          { error: "Failed to check period readiness" },
          { status: 500 }
        )
      }

      if (readiness.status === "BLOCKED") {
        return NextResponse.json(
          {
            error: "Period cannot be closed due to blockers",
            readiness: readiness,
          },
          { status: 400 }
        )
      }

      const auditChecks = await runAndLogCloseChecks()
      if (!auditChecks.ok) {
        return NextResponse.json(
          {
            error: "Period cannot be closed: audit checks failed",
            failures: auditChecks.failures,
          },
          { status: 400 }
        )
      }

      // Update period to closing status
      const { data: updatedPeriod, error: updateError } = await supabase
        .from("accounting_periods")
        .update({
          status: "closing",
          close_requested_at: new Date().toISOString(),
          close_requested_by: user.id,
        })
        .eq("id", period.id)
        .select()
        .single()

      if (updateError) {
        console.error("Error updating accounting period:", updateError)
        return NextResponse.json(
          { error: updateError.message || "Failed to update period" },
          { status: 500 }
        )
      }

      // Create audit record
      const { error: auditError } = await supabase
        .from("accounting_period_actions")
        .insert({
          business_id: resolvedBusinessId,
          period_start: period_start,
          action: "request_close",
          performed_by: user.id,
          performed_at: new Date().toISOString(),
        })

      if (auditError) {
        console.error("Error creating audit record:", auditError)
      }

      return NextResponse.json({
        success: true,
        period: updatedPeriod,
        readiness: readiness,
      })
    }

    if (action === "approve_close") {
      // Approve close: closing → soft_closed
      if (period.status !== "closing") {
        return NextResponse.json(
          { error: "approve_close is only allowed when status is 'closing'" },
          { status: 400 }
        )
      }

      const auditChecksApprove = await runAndLogCloseChecks()
      if (!auditChecksApprove.ok) {
        return NextResponse.json(
          {
            error: "Period cannot be closed: audit checks failed",
            failures: auditChecksApprove.failures,
          },
          { status: 400 }
        )
      }

      // Update period to soft_closed
      const { data: updatedPeriod, error: updateError } = await supabase
        .from("accounting_periods")
        .update({
          status: "soft_closed",
          closed_at: new Date().toISOString(),
          closed_by: user.id,
          close_requested_at: null,
          close_requested_by: null,
        })
        .eq("id", period.id)
        .select()
        .single()

      if (updateError) {
        console.error("Error updating accounting period:", updateError)
        return NextResponse.json(
          { error: updateError.message || "Failed to update period" },
          { status: 500 }
        )
      }

      // Create audit record
      const { error: auditError } = await supabase
        .from("accounting_period_actions")
        .insert({
          business_id: resolvedBusinessId,
          period_start: period_start,
          action: "approve_close",
          performed_by: user.id,
          performed_at: new Date().toISOString(),
        })

      if (auditError) {
        console.error("Error creating audit record:", auditError)
      }

      await logAudit({
        businessId: resolvedBusinessId,
        userId: user.id,
        actionType: "period_soft_close",
        entityType: "period",
        entityId: period.id,
        description: "soft_closed",
        newValues: { period_id: period.id, action: "approve_close", closed_by: user.id },
        request,
      })

      return NextResponse.json({
        success: true,
        period: updatedPeriod,
      })
    }

    if (action === "reject_close") {
      // Reject close: closing → open
      if (period.status !== "closing") {
        return NextResponse.json(
          { error: "reject_close is only allowed when status is 'closing'" },
          { status: 400 }
        )
      }

      // Update period back to open
      const { data: updatedPeriod, error: updateError } = await supabase
        .from("accounting_periods")
        .update({
          status: "open",
          close_requested_at: null,
          close_requested_by: null,
        })
        .eq("id", period.id)
        .select()
        .single()

      if (updateError) {
        console.error("Error updating accounting period:", updateError)
        return NextResponse.json(
          { error: updateError.message || "Failed to update period" },
          { status: 500 }
        )
      }

      // Create audit record
      const { error: auditError } = await supabase
        .from("accounting_period_actions")
        .insert({
          business_id: resolvedBusinessId,
          period_start: period_start,
          action: "reject_close",
          performed_by: user.id,
          performed_at: new Date().toISOString(),
        })

      if (auditError) {
        console.error("Error creating audit record:", auditError)
      }

      return NextResponse.json({
        success: true,
        period: updatedPeriod,
      })
    }

    // Legacy actions (soft_close, lock) - maintain backward compatibility
    // Validate status transitions
    if (action === "soft_close" && period.status !== "open") {
      return NextResponse.json(
        { error: "soft_close is only allowed when status is 'open'" },
        { status: 400 }
      )
    }

    // When business has active firm engagement, require request_close → approve_close (prevent bypass)
    if (action === "soft_close") {
      const { data: hasEngagement, error: engErr } = await supabase.rpc("business_has_active_engagement", {
        p_business_id: resolvedBusinessId,
      })
      if (!engErr && (hasEngagement === true || hasEngagement === "true")) {
        return NextResponse.json(
          {
            error:
              "Period close requires accountant approval when a firm is engaged. Use Request close for this period.",
          },
          { status: 400 }
        )
      }
    }

    if (action === "lock" && period.status !== "soft_closed") {
      return NextResponse.json(
        { error: "lock is only allowed when status is 'soft_closed'" },
        { status: 400 }
      )
    }

    const auditChecksLegacy = await runAndLogCloseChecks()
    if (!auditChecksLegacy.ok) {
      return NextResponse.json(
        {
          error: "Period cannot be closed: audit checks failed",
          failures: auditChecksLegacy.failures,
        },
        { status: 400 }
      )
    }

    // Determine new status
    const newStatus = action === "soft_close" ? "soft_closed" : "locked"

    // Update the period
    const { data: updatedPeriod, error: updateError } = await supabase
      .from("accounting_periods")
      .update({
        status: newStatus,
        closed_at: new Date().toISOString(),
        closed_by: user.id,
      })
      .eq("id", period.id)
      .select()
      .single()

    if (updateError) {
      console.error("Error updating accounting period:", updateError)
      return NextResponse.json(
        { error: updateError.message || "Failed to update period" },
        { status: 500 }
      )
    }

    // Create audit record
    const { error: auditError } = await supabase
      .from("accounting_period_actions")
      .insert({
        business_id: resolvedBusinessId,
        period_start: period_start,
        action: action,
        performed_by: user.id,
        performed_at: new Date().toISOString(),
      })

    if (auditError) {
      console.error("Error creating audit record:", auditError)
      // Don't fail the request if audit fails, but log it
      // In production, you might want to handle this differently
    }

    const auditActionType = action === "lock" ? "period_close" : "period_soft_close"
    const auditDescription = action === "lock" ? "closed" : "soft_closed"
    await logAudit({
      businessId: resolvedBusinessId,
      userId: user.id,
      actionType: auditActionType,
      entityType: "period",
      entityId: period.id,
      description: auditDescription,
      newValues: { period_id: period.id, action, closed_by: user.id },
      request,
    })

    return NextResponse.json({
      success: true,
      period: updatedPeriod,
    })
  } catch (error: any) {
    console.error("Error in period close:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

