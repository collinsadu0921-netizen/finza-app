import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/requireFirmMember"
import { checkFirmClientAccess } from "@/lib/firmClientAccess"

/**
 * POST /api/accounting/firm/bulk/preflight
 * 
 * Bulk preflight validation (AFS readiness check) for multiple clients
 * Read-only operation that checks if clients are ready for AFS generation/finalization
 * 
 * Body:
 * - business_ids: UUID[] (required) - Array of business IDs to validate
 * - operation: 'afs_draft' | 'afs_finalize' (required) - Type of operation to validate for
 * 
 * Access: Users who belong to accounting firms with access to the clients
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const forbidden = await requireFirmMemberForApi(supabase, user.id)
    if (forbidden) return forbidden

    const body = await request.json()
    const { business_ids, operation } = body

    if (!business_ids || !Array.isArray(business_ids) || business_ids.length === 0) {
      return NextResponse.json(
        { error: "Missing or invalid business_ids array" },
        { status: 400 }
      )
    }

    if (!operation || (operation !== "afs_draft" && operation !== "afs_finalize")) {
      return NextResponse.json(
        { error: "Missing or invalid operation. Must be 'afs_draft' or 'afs_finalize'" },
        { status: 400 }
      )
    }

    // Check access for all businesses
    const accessChecks = await Promise.all(
      business_ids.map(async (businessId: string) => {
        const access = await checkFirmClientAccess(supabase, user.id, businessId)
        return { businessId, access }
      })
    )

    const accessibleBusinessIds = accessChecks
      .filter((check) => check.access !== null)
      .map((check) => check.businessId)

    if (accessibleBusinessIds.length === 0) {
      return NextResponse.json(
        { error: "No accessible businesses found" },
        { status: 403 }
      )
    }

    // Perform preflight validation for each accessible business
    const validationResults = await Promise.all(
      accessibleBusinessIds.map(async (businessId: string) => {
        const access = accessChecks.find((c) => c.businessId === businessId)?.access

        try {
          // Get current period
          const { data: periods } = await supabase
            .from("accounting_periods")
            .select("id, period_start, period_end, status")
            .eq("business_id", businessId)
            .order("period_start", { ascending: false })
            .limit(1)

          const currentPeriod = periods && periods.length > 0 ? periods[0] : null

          // Get latest AFS run
          const { data: afsRuns } = await supabase
            .from("afs_runs")
            .select("id, status, created_at, input_hash")
            .eq("business_id", businessId)
            .order("created_at", { ascending: false })
            .limit(1)

          const latestAfsRun = afsRuns && afsRuns.length > 0 ? afsRuns[0] : null

          // Check for critical exceptions (if table exists)
          let criticalExceptionsCount = 0
          try {
            const { count } = await supabase
              .from("accounting_exceptions")
              .select("*", { count: "exact", head: true })
              .eq("business_id", businessId)
              .eq("severity", "critical")
              .eq("status", "open")
            criticalExceptionsCount = count || 0
          } catch {
            // Table doesn't exist yet - ignore
          }

          // Check for pending adjustments
          const { count: pendingAdjustmentsCount } = await supabase
            .from("journal_entries")
            .select("*", { count: "exact", head: true })
            .eq("business_id", businessId)
            .eq("reference_type", "adjustment")

          // Validation checks
          const issues: string[] = []
          const warnings: string[] = []

          if (operation === "afs_finalize") {
            if (!latestAfsRun) {
              issues.push("No AFS draft found")
            } else if (latestAfsRun.status !== "draft") {
              issues.push(`Latest AFS run is ${latestAfsRun.status}, not draft`)
            } else {
              // Check for new journal entries since AFS run
              let inputHashTimestamp: Date
              try {
                inputHashTimestamp = new Date(latestAfsRun.input_hash)
                if (isNaN(inputHashTimestamp.getTime())) {
                  inputHashTimestamp = new Date(latestAfsRun.created_at)
                }
              } catch {
                inputHashTimestamp = new Date(latestAfsRun.created_at)
              }

              const { count: newEntriesCount } = await supabase
                .from("journal_entries")
                .select("*", { count: "exact", head: true })
                .eq("business_id", businessId)
                .gt("created_at", inputHashTimestamp.toISOString())

              if (newEntriesCount && newEntriesCount > 0) {
                issues.push(`${newEntriesCount} new journal entries found after AFS draft`)
              }

              // Check for new critical exceptions
              try {
                const { count: newExceptionsCount } = await supabase
                  .from("accounting_exceptions")
                  .select("*", { count: "exact", head: true })
                  .eq("business_id", businessId)
                  .eq("severity", "critical")
                  .eq("status", "open")
                  .gt("created_at", inputHashTimestamp.toISOString())
                if (newExceptionsCount && newExceptionsCount > 0) {
                  issues.push(`${newExceptionsCount} new critical exceptions found after AFS draft`)
                }
              } catch {
                // Table doesn't exist - ignore
              }
            }
          }

          if (!currentPeriod) {
            warnings.push("No accounting period found")
          } else if (currentPeriod.status === "locked") {
            issues.push("Current period is locked")
          }

          if (criticalExceptionsCount > 0) {
            issues.push(`${criticalExceptionsCount} critical exceptions open`)
          }

          if (pendingAdjustmentsCount && pendingAdjustmentsCount > 0) {
            warnings.push(`${pendingAdjustmentsCount} pending adjustments`)
          }

          // Access level check
          if (operation === "afs_finalize" && access !== "write" && access !== "approve") {
            issues.push("Insufficient access level (write/approve required)")
          }

          return {
            business_id: businessId,
            access_level: access,
            ready: issues.length === 0,
            issues,
            warnings,
            current_period: currentPeriod
              ? {
                  id: currentPeriod.id,
                  period_start: currentPeriod.period_start,
                  period_end: currentPeriod.period_end,
                  status: currentPeriod.status,
                }
              : null,
            latest_afs_run: latestAfsRun
              ? {
                  id: latestAfsRun.id,
                  status: latestAfsRun.status,
                  created_at: latestAfsRun.created_at,
                }
              : null,
            critical_exceptions_count: criticalExceptionsCount,
            pending_adjustments_count: pendingAdjustmentsCount || 0,
          }
        } catch (error: any) {
          return {
            business_id: businessId,
            access_level: access,
            ready: false,
            issues: [`Validation error: ${error.message}`],
            warnings: [],
            current_period: null,
            latest_afs_run: null,
            critical_exceptions_count: 0,
            pending_adjustments_count: 0,
          }
        }
      })
    )

    const readyCount = validationResults.filter((r) => r.ready).length
    const notReadyCount = validationResults.length - readyCount

    return NextResponse.json({
      operation,
      total: validationResults.length,
      ready: readyCount,
      not_ready: notReadyCount,
      results: validationResults,
    })
  } catch (error: any) {
    console.error("Error in bulk preflight validation:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
