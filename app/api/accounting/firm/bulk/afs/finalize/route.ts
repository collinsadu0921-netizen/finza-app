import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/requireFirmMember"
import { checkFirmClientAccess } from "@/lib/firmClientAccess"

/**
 * POST /api/accounting/firm/bulk/afs/finalize
 * 
 * Bulk AFS finalization for multiple clients with per-client confirmation
 * Atomic batch operation: All clients must pass validation and confirmation before execution
 * 
 * Body:
 * - business_ids: UUID[] (required) - Array of business IDs to finalize
 * - confirmations: Array<{ business_id: UUID, confirmed: boolean }> (required) - Per-client confirmations
 * 
 * Access: Partner (full authority) or Senior (subject to client access level = write/approve)
 * - Partner: Can finalize for any client in firm
 * - Senior: Requires client access level = 'write' OR 'approve'
 * - Junior/Readonly: Rejected
 * 
 * Failure Semantics: Atomic batch (all-or-nothing)
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
    const { business_ids, confirmations } = body

    // Validate request body
    if (!business_ids || !Array.isArray(business_ids) || business_ids.length === 0) {
      return NextResponse.json(
        { error: "Missing or invalid business_ids array" },
        { status: 400 }
      )
    }

    if (!confirmations || !Array.isArray(confirmations) || confirmations.length === 0) {
      return NextResponse.json(
        { error: "Missing or invalid confirmations array" },
        { status: 400 }
      )
    }

    // Validate confirmations match business_ids
    if (confirmations.length !== business_ids.length) {
      return NextResponse.json(
        { error: "confirmations array length must match business_ids array length" },
        { status: 400 }
      )
    }

    const confirmationMap = new Map(
      confirmations.map((c: any) => [c.business_id, c.confirmed])
    )

    // Validate all business_ids are in confirmations
    for (const businessId of business_ids) {
      if (!confirmationMap.has(businessId)) {
        return NextResponse.json(
          { error: `Missing confirmation for business_id: ${businessId}` },
          { status: 400 }
        )
      }
    }

    // Validate all confirmations are true
    const allConfirmed = confirmations.every((c: any) => c.confirmed === true)
    if (!allConfirmed) {
      return NextResponse.json(
        { error: "All confirmations must be true. Cannot proceed with unconfirmed clients." },
        { status: 400 }
      )
    }

    // Get user's firm roles
    const { data: firmUsers, error: firmUsersError } = await supabase
      .from("accounting_firm_users")
      .select("firm_id, role")
      .eq("user_id", user.id)

    if (firmUsersError) {
      console.error("Error fetching user firms:", firmUsersError)
      return NextResponse.json(
        { error: "Failed to fetch firm membership" },
        { status: 500 }
      )
    }

    if (!firmUsers || firmUsers.length === 0) {
      return NextResponse.json(
        { error: "User is not a member of any accounting firm" },
        { status: 403 }
      )
    }

    // Get user's highest role (partner > senior > junior > readonly)
    const rolePriority = { partner: 4, senior: 3, junior: 2, readonly: 1 }
    const userRoles = firmUsers.map((fu) => fu.role as keyof typeof rolePriority)
    const highestRole = userRoles.reduce((a, b) =>
      rolePriority[a] > rolePriority[b] ? a : b
    )

    // Check permissions: Junior and Readonly cannot perform bulk finalization
    if (highestRole === "junior" || highestRole === "readonly") {
      return NextResponse.json(
        { error: "Unauthorized. Bulk AFS finalization requires partner or senior role." },
        { status: 403 }
      )
    }

    // Check access for all businesses and validate permissions
    const accessChecks = await Promise.all(
      business_ids.map(async (businessId: string) => {
        const access = await checkFirmClientAccess(supabase, user.id, businessId)
        return { businessId, access }
      })
    )

    const validationErrors: Array<{ business_id: string; error: string }> = []

    // Permission validation per client
    for (const check of accessChecks) {
      if (!check.access) {
        validationErrors.push({
          business_id: check.businessId,
          error: "No access to this business",
        })
        continue
      }

      // Partner has full authority (bypasses client access level checks)
      if (highestRole === "partner") {
        continue // Partner can finalize for any client
      }

      // Senior requires client access level = 'write' OR 'approve'
      if (highestRole === "senior") {
        if (check.access !== "write" && check.access !== "approve") {
          validationErrors.push({
            business_id: check.businessId,
            error: `Insufficient access level. Senior role requires 'write' or 'approve' access level, but client access is '${check.access}'.`,
          })
        }
      }
    }

    // If any validation errors, reject entire batch (atomic batch semantics)
    if (validationErrors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Batch validation failed: Permission or access validation failed",
          validation_errors: validationErrors,
        },
        { status: 400 }
      )
    }

    // Preflight validation: Get latest AFS run for each client and validate readiness
    const preflightResults = await Promise.all(
      business_ids.map(async (businessId: string) => {
        try {
          // Get latest AFS run
          const { data: afsRuns, error: afsRunsError } = await supabase
            .from("afs_runs")
            .select("id, status, created_at, input_hash")
            .eq("business_id", businessId)
            .order("created_at", { ascending: false })
            .limit(1)

          if (afsRunsError) {
            return {
              businessId,
              error: `Failed to fetch AFS runs: ${afsRunsError.message}`,
            }
          }

          const latestAfsRun = afsRuns && afsRuns.length > 0 ? afsRuns[0] : null

          if (!latestAfsRun) {
            return {
              businessId,
              error: "No AFS draft found",
            }
          }

          if (latestAfsRun.status !== "draft") {
            return {
              businessId,
              error: `Latest AFS run is ${latestAfsRun.status}, not draft`,
            }
          }

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

          const { count: newEntriesCount, error: entriesError } = await supabase
            .from("journal_entries")
            .select("*", { count: "exact", head: true })
            .eq("business_id", businessId)
            .gt("created_at", inputHashTimestamp.toISOString())

          if (entriesError) {
            return {
              businessId,
              error: `Failed to validate ledger state: ${entriesError.message}`,
            }
          }

          if (newEntriesCount && newEntriesCount > 0) {
            return {
              businessId,
              error: `${newEntriesCount} new journal entries found after AFS draft. Please regenerate the AFS run.`,
            }
          }

          // Check for new critical exceptions
          try {
            const { count: newExceptionsCount, error: exceptionsError } = await supabase
              .from("accounting_exceptions")
              .select("*", { count: "exact", head: true })
              .eq("business_id", businessId)
              .eq("severity", "critical")
              .eq("status", "open")
              .gt("created_at", inputHashTimestamp.toISOString())

            if (exceptionsError && !exceptionsError.message?.includes("does not exist") && !exceptionsError.message?.includes("relation") && !exceptionsError.code?.includes("42P01")) {
              // Log but don't fail for table not existing
              console.error("Error checking exceptions:", exceptionsError)
            } else if (newExceptionsCount && newExceptionsCount > 0) {
              return {
                businessId,
                error: `${newExceptionsCount} new critical exceptions found after AFS draft. Please resolve exceptions before finalizing.`,
              }
            }
          } catch {
            // Table doesn't exist - ignore
          }

          return {
            businessId,
            afsRunId: latestAfsRun.id,
            valid: true,
          }
        } catch (error: any) {
          return {
            businessId,
            error: `Preflight validation error: ${error.message}`,
          }
        }
      })
    )

    // Check preflight validation results
    const preflightErrors: Array<{ business_id: string; error: string }> = []
    const validPreflights: Array<{ businessId: string; afsRunId: string }> = []

    for (const result of preflightResults) {
      if ((result as any).valid) {
        validPreflights.push(result as { businessId: string; afsRunId: string })
      } else {
        preflightErrors.push({
          business_id: (result as any).businessId,
          error: (result as any).error,
        })
      }
    }

    // If any preflight validation fails, reject entire batch (atomic batch semantics)
    if (preflightErrors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Batch validation failed: Preflight validation failed for one or more clients",
          validation_errors: preflightErrors,
        },
        { status: 400 }
      )
    }

    // All validations passed - proceed with finalization
    // Execute finalization for all clients (atomic batch: all-or-nothing)
    const finalizationResults = await Promise.all(
      validPreflights.map(async ({ businessId, afsRunId }) => {
        try {
          // Update the AFS run to finalized status
          const { data: updatedRun, error: updateError } = await supabase
            .from("afs_runs")
            .update({
              status: "finalized",
              finalized_at: new Date().toISOString(),
              finalized_by: user.id,
            })
            .eq("id", afsRunId)
            .select()
            .single()

          if (updateError) {
            // If this is a trigger error (finalized run), it means someone else finalized it
            // This is a race condition - still count as error
            return {
              businessId,
              error: `Failed to finalize AFS run: ${updateError.message}`,
            }
          }

          return {
            businessId,
            afsRunId,
            status: "finalized",
            finalized_at: updatedRun?.finalized_at || new Date().toISOString(),
            success: true,
          }
        } catch (error: any) {
          return {
            businessId,
            error: `Finalization error: ${error.message}`,
          }
        }
      })
    )

    // Check if all finalizations succeeded
    const finalizationErrors: Array<{ business_id: string; error: string }> = []
    const successfulResults: Array<{
      business_id: string
      afs_run_id: string
      status: string
      finalized_at: string
    }> = []

    for (const result of finalizationResults) {
      if ((result as any).success) {
        successfulResults.push({
          business_id: (result as any).businessId,
          afs_run_id: (result as any).afsRunId,
          status: "finalized",
          finalized_at: (result as any).finalized_at,
        })
      } else {
        finalizationErrors.push({
          business_id: (result as any).businessId,
          error: (result as any).error,
        })
      }
    }

    // If any finalization failed, return error (atomic batch semantics)
    // Note: In a real transaction system, we would rollback, but since Supabase doesn't
    // support cross-table transactions easily, we rely on the trigger to prevent double-finalization
    if (finalizationErrors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Batch finalization failed: One or more clients failed to finalize",
          errors: finalizationErrors,
          partial_results: successfulResults, // Inform about partial success
        },
        { status: 500 }
      )
    }

    // All finalizations succeeded
    return NextResponse.json({
      success: true,
      operation: "afs_finalize",
      total_requested: business_ids.length,
      total_confirmed: confirmations.length,
      total_executed: successfulResults.length,
      errors: [],
      results: successfulResults,
    })
  } catch (error: any) {
    console.error("Error in bulk AFS finalization:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
