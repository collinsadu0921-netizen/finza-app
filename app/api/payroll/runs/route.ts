import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import {
  computeStaffPayrollEntry,
  isPayrollEngineCountryError,
} from "@/lib/payroll/computeStaffPayrollEntry"
import { rollupPayrollRunTotals } from "@/lib/payroll/rollupPayrollRunTotals"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { logAudit } from "@/lib/auditLog"
import {
  enforceServiceIndustryMinTier,
  enforceServiceIndustryMinTierWrite,
} from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { createRouteDiag, supabaseErrorDiag, timedStepMs } from "@/lib/server/routeDiagnostics"
import {
  loadOrComputeOperationalListCache,
} from "@/lib/server/operationalListCache"

const DEFAULT_PAYROLL_RUNS_LIMIT = 24
const MAX_PAYROLL_RUNS_LIMIT = 100

const PAYROLL_RUN_LIST_SELECT = `
  id,
  business_id,
  payroll_month,
  status,
  total_gross_salary,
  total_allowances,
  total_deductions,
  total_ssnit_employee,
  total_ssnit_employer,
  total_paye,
  total_net_salary,
  approved_by,
  approved_at,
  journal_entry_id,
  notes,
  created_at,
  updated_at
`.replace(/\s+/g, " ")

async function fetchStaffAllowancesAndDeductions(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  staffId: string
) {
  const [{ data: allowances }, { data: deductions }] = await Promise.all([
    supabase
      .from("allowances")
      .select("type, amount, recurring")
      .eq("staff_id", staffId)
      .is("deleted_at", null),
    supabase
      .from("deductions")
      .select("amount")
      .eq("staff_id", staffId)
      .is("deleted_at", null),
  ])
  return { allowances: allowances || [], deductions: deductions || [] }
}

export async function GET(request: NextRequest) {
  let diag = createRouteDiag("payroll_runs")
  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      diag.fail(401, "Unauthorized")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    diag.step("auth", { ms_auth: timedStepMs(tAuth) })

    if (!business) {
      diag.fail(404, "business_not_found")
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    diag = createRouteDiag("payroll_runs", business.id)

    const tTier = performance.now()
    const tierDenied = await enforceServiceIndustryMinTier(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    diag.step("entitlement", { ms_entitlement: timedStepMs(tTier) })
    if (tierDenied) {
      diag.fail(tierDenied.status, "tier_denied")
      return tierDenied
    }

    const tPerm = performance.now()
    const { allowed: canView } = await requirePermission(
      supabase, user.id, business.id, PERMISSIONS.PAYROLL_VIEW
    )
    diag.step("permission", { ms_permission: timedStepMs(tPerm), allowed: canView })
    if (!canView) {
      diag.fail(403, "forbidden")
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = Math.max(
      1,
      Number.parseInt(searchParams.get("page") || "1", 10) || 1
    )
    const limitRaw = Number.parseInt(
      searchParams.get("limit") || String(DEFAULT_PAYROLL_RUNS_LIMIT),
      10
    ) || DEFAULT_PAYROLL_RUNS_LIMIT
    const limit = Math.min(MAX_PAYROLL_RUNS_LIMIT, Math.max(1, limitRaw))
    const from = (page - 1) * limit
    const to = from + limit - 1

    const cacheKey = ["payroll_runs", business.id, page, limit].join("|")

    const { value: payload, source: cacheSource, cache_enabled } =
      await loadOrComputeOperationalListCache(cacheKey, async () => {
        const tQuery = performance.now()
        const { data: runs, error, count } = await supabase
          .from("payroll_runs")
          .select(PAYROLL_RUN_LIST_SELECT, { count: "exact" })
          .eq("business_id", business.id)
          .is("deleted_at", null)
          .order("payroll_month", { ascending: false })
          .range(from, to)

        if (error) {
          diag.step("payroll_runs_query", {
            ms_query: timedStepMs(tQuery),
            ...supabaseErrorDiag(error),
          })
          throw error
        }

        const totalCount = count ?? 0
        diag.step("payroll_runs_query", {
          ms_query: timedStepMs(tQuery),
          row_count: (runs ?? []).length,
          total_count: totalCount,
          page,
          limit,
        })

        return {
          runs: runs || [],
          pagination: {
            page,
            limit,
            totalCount,
            hasMore: from + (runs?.length ?? 0) < totalCount,
          },
        }
      })

    diag.step("cache", {
      cache_source: cacheSource,
      cache_enabled,
      row_count: payload.runs.length,
    })

    diag.finish(200)
    return NextResponse.json(payload)
  } catch (error: unknown) {
    console.error("Error in payroll runs list:", error)
    const message = error instanceof Error ? error.message : "Internal server error"
    const meta =
      error && typeof error === "object" && "code" in error
        ? supabaseErrorDiag(error as { code?: string; message?: string; details?: string; hint?: string })
        : undefined
    diag.fail(500, message, meta)
    return NextResponse.json({ error: message }, { status: 500 })
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

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const tierDeniedPost = await enforceServiceIndustryMinTierWrite(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (tierDeniedPost) return tierDeniedPost

    const { allowed: canCreate } = await requirePermission(
      supabase, user.id, business.id, PERMISSIONS.PAYROLL_CREATE
    )
    if (!canCreate) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    const body = await request.json()
    const { payroll_month } = body

    if (!payroll_month) {
      return NextResponse.json(
        { error: "Missing payroll_month" },
        { status: 400 }
      )
    }

    // Check if payroll run already exists for this month
    const { data: existingRun } = await supabase
      .from("payroll_runs")
      .select("id")
      .eq("business_id", business.id)
      .eq("payroll_month", payroll_month)
      .is("deleted_at", null)
      .single()

    if (existingRun) {
      return NextResponse.json(
        { error: "Payroll run already exists for this month" },
        { status: 400 }
      )
    }

    // Get all active staff
    const { data: staffList, error: staffError } = await supabase
      .from("staff")
      .select("*")
      .eq("business_id", business.id)
      .eq("status", "active")
      .is("deleted_at", null)

    if (staffError) {
      console.error("Error fetching staff:", staffError)
      return NextResponse.json(
        { error: staffError.message },
        { status: 500 }
      )
    }

    if (!staffList || staffList.length === 0) {
      return NextResponse.json(
        { error: "No active staff found" },
        { status: 400 }
      )
    }

    // Get business country for payroll engine resolution
    const businessCountry = business.address_country || business.country_code || null

    if (!businessCountry) {
      return NextResponse.json(
        { error: "Business country is required for payroll calculation. Please set country in Business Profile settings." },
        { status: 400 }
      )
    }

    // Validate effectiveDate (use payroll_month as effectiveDate for versioning)
    const effectiveDate = payroll_month // payroll_month drives effectiveDate for deterministic calculations

    // Calculate payroll for each staff using payroll engine
    const payrollEntries = []

    for (const staff of staffList) {
      const { allowances, deductions } = await fetchStaffAllowancesAndDeductions(supabase, staff.id)

      try {
        const computed = computeStaffPayrollEntry({
          staff,
          businessCountry,
          effectiveDate,
          allowances,
          deductions,
          isIncluded: true,
        })

        const allowancesTotal = computed.allowances_total
        const expectedGross = (Number(staff.basic_salary) || 0) + allowancesTotal
        if (Math.abs(Number(computed.gross_salary || 0) - expectedGross) > 0.01) {
          return NextResponse.json(
            { error: `Payroll component reconciliation failed for ${staff.name || "staff"}: gross mismatch.` },
            { status: 400 }
          )
        }

        payrollEntries.push(computed)
      } catch (error: unknown) {
        if (isPayrollEngineCountryError(error)) {
          return NextResponse.json({ error: error.message }, { status: 400 })
        }
        throw error
      }
    }

    const runTotals = rollupPayrollRunTotals(payrollEntries)

    // Create payroll run
    const { data: payrollRun, error: runError } = await supabase
      .from("payroll_runs")
      .insert({
        business_id: business.id,
        payroll_month,
        status: "draft",
        total_gross_salary: runTotals.total_gross_salary,
        total_allowances: runTotals.total_allowances,
        total_deductions: runTotals.total_deductions,
        total_ssnit_employee: runTotals.total_ssnit_employee,
        total_ssnit_employer: runTotals.total_ssnit_employer,
        total_paye: runTotals.total_paye,
        total_net_salary: runTotals.total_net_salary,
      })
      .select()
      .single()

    if (runError) {
      console.error("Error creating payroll run:", runError)
      return NextResponse.json(
        { error: runError.message },
        { status: 500 }
      )
    }

    // Create payroll entries
    const entriesWithRunId = payrollEntries.map((entry) => ({
      ...entry,
      payroll_run_id: payrollRun.id,
    }))

    const { error: entriesError } = await supabase
      .from("payroll_entries")
      .insert(entriesWithRunId)

    if (entriesError) {
      console.error("Error creating payroll entries:", entriesError)
      // Rollback payroll run
      await supabase.from("payroll_runs").delete().eq("id", payrollRun.id)
      return NextResponse.json(
        { error: entriesError.message },
        { status: 500 }
      )
    }

    await logAudit({
      businessId: business.id,
      userId: user.id,
      actionType: "payroll.run_created",
      entityType: "payroll_run",
      entityId: payrollRun.id,
      newValues: {
        payroll_month,
        total_gross_salary: runTotals.total_gross_salary,
        total_net_salary: runTotals.total_net_salary,
        staff_count: staffList.length,
        status: "draft",
      },
      description: `Created payroll run for ${payroll_month} (${staffList.length} staff, gross ${runTotals.total_gross_salary})`,
      request,
    })

    return NextResponse.json({ payrollRun }, { status: 201 })
  } catch (error: any) {
    console.error("Error creating payroll run:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


