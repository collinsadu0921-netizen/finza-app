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
import { resolveAuthenticatedApiUser } from "@/lib/server/resolveAuthenticatedApiUser"
import { createRouteDiag, supabaseErrorDiag, timedStepMs } from "@/lib/server/routeDiagnostics"
import {
  loadOrComputeOperationalListCache,
} from "@/lib/server/operationalListCache"
import {
  resolveCreatePayrollRunPeriod,
} from "@/lib/payroll/payrollPeriodUtils"
import { computeStaffScopeFingerprint } from "@/lib/payroll/payrollPeriod"
import {
  assertNoDuplicatePayrollRun,
  DuplicatePayrollRunError,
} from "@/lib/payroll/payrollDuplicateGuard"
import { filterPayrollItemsForRun } from "@/lib/payroll/periodPayrollItems"
import {
  assertPhase1BPayrollFrequency,
  exclusionReasonForSalaryBasisMismatch,
  parseSalaryBasis,
  salaryBasisMatchesFrequency,
} from "@/lib/payroll/salaryBasis"

const DEFAULT_PAYROLL_RUNS_LIMIT = 24
const MAX_PAYROLL_RUNS_LIMIT = 100

const PAYROLL_RUN_LIST_SELECT = `
  id,
  business_id,
  payroll_month,
  pay_period_start,
  pay_period_end,
  payroll_frequency,
  run_type,
  corrects_payroll_run_id,
  staff_scope_fingerprint,
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
      .select("id, type, amount, recurring, description, applies_to_month, payroll_run_id")
      .eq("staff_id", staffId)
      .is("deleted_at", null),
    supabase
      .from("deductions")
      .select("id, type, amount, recurring, description, applies_to_month, payroll_run_id")
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
    const auth = await resolveAuthenticatedApiUser(supabase, {
      cookieHeader: request.headers.get("cookie"),
    })

    if (!auth.ok) {
      diag.fail(auth.status, auth.error, { auth_failure_stage: auth.authFailureStage })
      return NextResponse.json(
        { error: auth.error, auth_failure_stage: auth.authFailureStage },
        { status: auth.status }
      )
    }
    const user = auth.user

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
          .order("pay_period_start", { ascending: false })
          .order("created_at", { ascending: false })
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

    let periodFields
    try {
      periodFields = resolveCreatePayrollRunPeriod(body)
      assertPhase1BPayrollFrequency(periodFields.payroll_frequency)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Invalid payroll period"
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const { payroll_month, pay_period_start, pay_period_end, payroll_frequency, run_type, corrects_payroll_run_id } =
      periodFields

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

    const eligibleStaff = staffList.filter((staff) =>
      salaryBasisMatchesFrequency(parseSalaryBasis(staff.salary_basis), payroll_frequency)
    )

    if (eligibleStaff.length === 0) {
      return NextResponse.json(
        {
          error: `No eligible employees for ${payroll_frequency} payroll. Employees must have matching salary basis (${payroll_frequency}).`,
          code: "NO_ELIGIBLE_EMPLOYEES",
        },
        { status: 400 }
      )
    }

    const staffScopeFingerprint = computeStaffScopeFingerprint(eligibleStaff.map((s) => s.id))

    const { data: existingRuns, error: existingRunsError } = await supabase
      .from("payroll_runs")
      .select(
        "id, business_id, payroll_frequency, run_type, pay_period_start, pay_period_end, staff_scope_fingerprint, status, deleted_at"
      )
      .eq("business_id", business.id)
      .is("deleted_at", null)

    if (existingRunsError) {
      return NextResponse.json({ error: existingRunsError.message }, { status: 500 })
    }

    try {
      assertNoDuplicatePayrollRun(
        {
          business_id: business.id,
          payroll_frequency,
          run_type,
          pay_period_start,
          pay_period_end,
          staff_scope_fingerprint: staffScopeFingerprint,
        },
        existingRuns || []
      )
    } catch (err: unknown) {
      if (err instanceof DuplicatePayrollRunError) {
        return NextResponse.json({ error: err.message, existingRunId: err.existingRunId }, { status: 409 })
      }
      throw err
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
    const legacyItemWarnings: Array<{ staff_id: string; reason: string }> = []

    for (const staff of staffList) {
      const salaryBasis = parseSalaryBasis(staff.salary_basis)
      const eligible = salaryBasisMatchesFrequency(salaryBasis, payroll_frequency)
      const { allowances, deductions } = await fetchStaffAllowancesAndDeductions(supabase, staff.id)

      // Run id is unknown until insert; exact-run one-offs are applied after create / on entry refresh.
      const filtered = filterPayrollItemsForRun({
        allowances,
        deductions,
        payrollRunId: null,
        payrollFrequency: payroll_frequency,
        payrollMonth: payroll_month,
      })
      for (const skipped of filtered.legacySkipped) {
        legacyItemWarnings.push({
          staff_id: staff.id,
          reason: skipped.reason,
        })
      }

      try {
        if (!eligible) {
          payrollEntries.push(
            computeStaffPayrollEntry({
              staff,
              businessCountry,
              effectiveDate,
              allowances: [],
              deductions: [],
              isIncluded: false,
              exclusionReason: exclusionReasonForSalaryBasisMismatch(salaryBasis, payroll_frequency),
              salaryBasisSnapshot: salaryBasis,
              oneOffItemsSnapshot: [],
            })
          )
          continue
        }

        const computed = computeStaffPayrollEntry({
          staff,
          businessCountry,
          effectiveDate,
          allowances: filtered.includedAllowances,
          deductions: filtered.includedDeductions,
          isIncluded: true,
          salaryBasisSnapshot: salaryBasis,
          oneOffItemsSnapshot: filtered.oneOffSnapshots,
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
        pay_period_start,
        pay_period_end,
        payroll_frequency,
        run_type,
        corrects_payroll_run_id: corrects_payroll_run_id || null,
        staff_scope_fingerprint: staffScopeFingerprint,
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
        pay_period_start,
        pay_period_end,
        payroll_frequency,
        run_type,
        total_gross_salary: runTotals.total_gross_salary,
        total_net_salary: runTotals.total_net_salary,
        staff_count: staffList.length,
        status: "draft",
      },
      description: `Created payroll run for ${pay_period_start} to ${pay_period_end} (${eligibleStaff.length} eligible / ${staffList.length} staff, gross ${runTotals.total_gross_salary})`,
      request,
    })

    return NextResponse.json(
      {
        payrollRun,
        eligible_count: eligibleStaff.length,
        excluded_count: staffList.length - eligibleStaff.length,
        legacy_item_warnings: legacyItemWarnings.slice(0, 50),
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error("Error creating payroll run:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


