import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { calculatePayroll } from "@/lib/payrollEngine"
import { MissingCountryError, UnsupportedCountryError } from "@/lib/payrollEngine/errors"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { logAudit } from "@/lib/auditLog"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { effectiveAllowanceBucket } from "@/lib/payroll/allowanceBuckets"
import {
  buildPayrollTaxProfileSnapshotForEntry,
  normalizeGraPositionCode,
  parseStaffIsPensionable,
  parseStaffIsTaxResident,
  parseStaffSecondaryEmployment,
} from "@/lib/payroll/staffTaxProfile"

/**
 * Heuristic only — statutory junior staff for overtime concession requires income tests (engine uses annualQualifyingEmploymentIncomeYtd).
 */
function juniorStaffHeuristicFromProfile(staff: { employment_type?: string | null; position?: string | null }): boolean {
  const employmentType = String(staff.employment_type || "").toLowerCase()
  const position = String(staff.position || "").toLowerCase()
  return employmentType.includes("junior") || position.includes("junior")
}

/**
 * Allowances/deductions: recurring=true (or legacy null) → every payroll run.
 * recurring=false → include only when applies_to_month matches this run's payroll_month (YYYY-MM-DD, usually first of month).
 * recurring=false and applies_to_month null → keep legacy behaviour (still include every run) until rows are backfilled.
 */
function includePayrollLineForMonth(
  recurring: boolean | null | undefined,
  appliesToMonth: string | null | undefined,
  payrollMonth: string
): boolean {
  if (recurring !== false) return true
  const runMonth = String(payrollMonth || "").slice(0, 10)
  const applies = appliesToMonth ? String(appliesToMonth).slice(0, 10) : ""
  if (!applies) return true
  return applies === runMonth
}

export async function GET(request: NextRequest) {
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

    const tierDenied = await enforceServiceIndustryMinTier(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (tierDenied) return tierDenied

    const { allowed: canView } = await requirePermission(
      supabase, user.id, business.id, PERMISSIONS.PAYROLL_VIEW
    )
    if (!canView) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    const { data: runs, error } = await supabase
      .from("payroll_runs")
      .select("*")
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("payroll_month", { ascending: false })

    if (error) {
      console.error("Error fetching payroll runs:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ runs: runs || [] })
  } catch (error: any) {
    console.error("Error in payroll runs list:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
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

    const tierDeniedPost = await enforceServiceIndustryMinTier(
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

    const staffIds = staffList.map((s: { id: string }) => String(s.id))
    const payrollYear = String(payroll_month).slice(0, 4)
    const yearStartMonth = `${payrollYear}-01-01`
    const bonusYtdByStaffId = new Map<string, number>()
    if (staffIds.length > 0) {
      const { data: priorRuns } = await supabase
        .from("payroll_runs")
        .select("id")
        .eq("business_id", business.id)
        .lt("payroll_month", payroll_month)
        .gte("payroll_month", yearStartMonth)
        .in("status", ["approved", "locked"])
        .is("deleted_at", null)

      const priorRunIds = (priorRuns ?? []).map((r: { id: string }) => r.id)
      if (priorRunIds.length > 0) {
        const { data: bonusRows } = await supabase
          .from("payroll_entries")
          .select("staff_id,bonus_amount")
          .in("payroll_run_id", priorRunIds)
          .in("staff_id", staffIds)

        for (const row of bonusRows ?? []) {
          const sid = String((row as { staff_id: string }).staff_id)
          const amt = Number((row as { bonus_amount?: number }).bonus_amount ?? 0)
          if (!Number.isFinite(amt)) continue
          bonusYtdByStaffId.set(sid, (bonusYtdByStaffId.get(sid) ?? 0) + amt)
        }
      }
    }

    // Calculate payroll for each staff using payroll engine
    const payrollEntries = []
    const pendingRepaymentDrafts: Array<{
      staff_id: string
      salary_advance_id: string
      amount: number
    }> = []
    let totalGross = 0
    let totalAllowances = 0
    let totalDeductions = 0
    let totalSsnitEmployee = 0
    let totalSsnitEmployer = 0
    let totalPaye = 0
    let totalNet = 0

    for (const staff of staffList) {
      const staffIsTaxResident = parseStaffIsTaxResident((staff as { is_tax_resident?: boolean }).is_tax_resident)
      const staffIsPensionable = parseStaffIsPensionable((staff as { is_pensionable?: boolean }).is_pensionable)
      const graPositionCode = normalizeGraPositionCode((staff as { gra_position_code?: string | null }).gra_position_code)
      const secondaryEmployment = parseStaffSecondaryEmployment(
        (staff as { secondary_employment?: boolean }).secondary_employment
      )

      // Allowances: recurring each month; non-recurring scoped by applies_to_month when set (migration 464).
      // Bucket split: use payroll_allowance_types.maps_to_bucket when allowance_type_id links a row;
      // otherwise fall back to legacy allowances.type ('bonus' | 'overtime' vs regular).
      //
      // TODO(is_taxable / is_pensionable): Flags on payroll_allowance_types are stored for future Ghana
      // allowance-specific tax treatment; payroll engine does not consume them in this phase.
      // TODO: payroll_entry_allowance_lines snapshot for audit-grade allowance lines on payslips/exports.
      const { data: allowances } = await supabase
        .from("allowances")
        .select("type, amount, recurring, applies_to_month, allowance_type_id, payroll_allowance_types(maps_to_bucket)")
        .eq("staff_id", staff.id)
        .is("deleted_at", null)

      const allowanceRows = (allowances ?? []).filter((a: any) =>
        includePayrollLineForMonth(a.recurring, a.applies_to_month, payroll_month)
      )

      const bonusAmount = allowanceRows
        .filter((a: any) => effectiveAllowanceBucket(a) === "bonus")
        .reduce((sum, a: any) => sum + Number(a.amount || 0), 0) || 0
      const overtimeAmount = allowanceRows
        .filter((a: any) => effectiveAllowanceBucket(a) === "overtime")
        .reduce((sum, a: any) => sum + Number(a.amount || 0), 0) || 0
      const regularAllowances = allowanceRows
        .filter((a: any) => effectiveAllowanceBucket(a) === "regular")
        .reduce((sum, a: any) => sum + Number(a.amount || 0), 0) || 0
      const allowancesTotal = regularAllowances + bonusAmount + overtimeAmount

      const { data: deductions } = await supabase
        .from("deductions")
        .select("amount, type, advance_id, recurring, applies_to_month")
        .eq("staff_id", staff.id)
        .is("deleted_at", null)

      const deductionRows = (deductions ?? []).filter((d: any) =>
        includePayrollLineForMonth(d.recurring, d.applies_to_month, payroll_month)
      )

      const normalizedDeductions = deductionRows.map((d: any) => ({
        amount: Number(d.amount || 0),
        type: String(d.type || "").toLowerCase(),
        advance_id: d.advance_id ? String(d.advance_id) : null,
      }))

      const nonAdvanceDeductionsTotal = normalizedDeductions
        .filter((d) => d.type !== "advance" || !d.advance_id)
        .reduce((sum, d) => sum + d.amount, 0)

      const advanceDeductionRows = normalizedDeductions.filter((d) => d.type === "advance" && d.advance_id)
      const advanceIds = Array.from(new Set(advanceDeductionRows.map((d) => String(d.advance_id))))

      const { data: salaryAdvances } = advanceIds.length > 0
        ? await supabase
            .from("salary_advances")
            .select("id, amount, monthly_repayment, repaid_amount, status")
            .eq("business_id", business.id)
            .eq("staff_id", staff.id)
            .in("id", advanceIds)
        : { data: [] as any[] }

      const outstandingByAdvanceId = new Map<string, number>()
      for (const advance of salaryAdvances || []) {
        const advanceStatus = String(advance.status || "outstanding")
        if (advanceStatus === "cancelled" || advanceStatus === "cleared") {
          continue
        }
        const outstanding = Math.max(
          0,
          Number(advance.amount || 0) - Number(advance.repaid_amount || 0)
        )
        if (outstanding > 0) {
          outstandingByAdvanceId.set(String(advance.id), outstanding)
        }
      }

      const { data: provisionalResult, error: provisionalCalcError } = await Promise.resolve().then(() => {
        try {
            return {
            data: calculatePayroll(
              {
                jurisdiction: businessCountry,
                effectiveDate,
                basicSalary: Number(staff.basic_salary) || 0,
                allowances: allowancesTotal,
                otherDeductions: nonAdvanceDeductionsTotal,
                bonusAmount,
                overtimeAmount,
                isQualifyingJuniorEmployee: juniorStaffHeuristicFromProfile(staff),
                priorBonusPaidInCalendarYear: bonusYtdByStaffId.get(String(staff.id)) ?? 0,
                employmentCategory: staff.employment_type ?? null,
                isResident: staffIsTaxResident,
                isPensionable: staffIsPensionable,
              },
              businessCountry
            ),
            error: null,
          }
        } catch (e) {
          return { data: null, error: e }
        }
      })

      if (provisionalCalcError) {
        throw provisionalCalcError
      }

      const maxAdvanceRepaymentAllowed = Math.max(0, Number(provisionalResult?.totals?.netSalary || 0))
      let remainingAdvanceCapacity = maxAdvanceRepaymentAllowed
      const cappedAdvanceRepayments: Array<{ salary_advance_id: string; amount: number }> = []

      for (const row of advanceDeductionRows) {
        const advanceId = String(row.advance_id)
        const outstanding = outstandingByAdvanceId.get(advanceId) || 0
        if (outstanding <= 0 || remainingAdvanceCapacity <= 0) continue

        const requested = row.amount > 0 ? row.amount : Number(
          (salaryAdvances || []).find((a: any) => String(a.id) === advanceId)?.monthly_repayment || 0
        )
        const capped = Math.max(0, Math.min(requested, outstanding, remainingAdvanceCapacity))
        if (capped <= 0) continue

        cappedAdvanceRepayments.push({ salary_advance_id: advanceId, amount: capped })
        outstandingByAdvanceId.set(advanceId, outstanding - capped)
        remainingAdvanceCapacity -= capped
      }

      const cappedAdvanceDeductionsTotal = cappedAdvanceRepayments.reduce((sum, r) => sum + r.amount, 0)
      const deductionsTotal = nonAdvanceDeductionsTotal + cappedAdvanceDeductionsTotal

      // Calculate payroll using new engine
      try {
        const payrollResult = calculatePayroll(
          {
            jurisdiction: businessCountry, // Will be normalized by engine
            effectiveDate,
            basicSalary: Number(staff.basic_salary) || 0,
            allowances: allowancesTotal,
            otherDeductions: deductionsTotal,
            bonusAmount,
            overtimeAmount,
            isQualifyingJuniorEmployee: juniorStaffHeuristicFromProfile(staff),
            priorBonusPaidInCalendarYear: bonusYtdByStaffId.get(String(staff.id)) ?? 0,
            employmentCategory: staff.employment_type ?? null,
            isResident: staffIsTaxResident,
            isPensionable: staffIsPensionable,
          },
          businessCountry
        )

        // Extract payroll components dynamically for multi-country support
        // 
        // RULE 1: Employee statutory contributions (stored into ssnit_employee field)
        // Note: ssnit_* fields are "statutory contribution aggregates" for all countries (schema uses Ghana-centric names for backward compatibility)
        // Sum ALL statutoryDeductions EXCEPT:
        //   - code === 'PAYE' (income tax, stored separately)
        //   - code === 'CBHI' (Community Based Health Insurance - net-based health solidarity contribution; do not merge into pension bucket)
        // Ghana: SSNIT_EMPLOYEE → ssnit_employee
        // Kenya: NSSF_EMPLOYEE + SHIF + AHL_EMPLOYEE → ssnit_employee (aggregated)
        // Rwanda: RSSB_PENSION_EMPLOYEE + RSSB_MATERNITY_EMPLOYEE → ssnit_employee (aggregated)
        // Future countries: All employee statutory contributions (except PAYE and CBHI) aggregate here
        const employeeStatutoryContributions = payrollResult.statutoryDeductions
          .filter(d => d.code !== 'PAYE' && d.code !== 'CBHI')
          .reduce((sum, d) => {
            const amount = Number(d.amount) || 0
            return sum + (Number.isFinite(amount) ? amount : 0)
          }, 0)
        
        // RULE 2: PAYE (income tax)
        // Extract statutoryDeductions where code === 'PAYE'
        // Works for all countries (Ghana, Kenya, future countries)
        const payeDeduction = payrollResult.statutoryDeductions.find(d => d.code === 'PAYE')
        const payeAmount = payeDeduction?.amount
        const paye = (payeAmount !== undefined && Number.isFinite(Number(payeAmount))) ? Number(payeAmount) : 0
        
        // RULE 3: Employer statutory contributions
        // Sum ALL employerContributions amounts
        // Ghana: SSNIT_EMPLOYER → ssnit_employer
        // Kenya: NSSF_EMPLOYER + AHL_EMPLOYER → ssnit_employer (aggregated)
        // Future countries: All employer contributions aggregate here
        const employerStatutoryContributions = payrollResult.employerContributions
          .reduce((sum, c) => {
            const amount = Number(c.amount) || 0
            return sum + (Number.isFinite(amount) ? amount : 0)
          }, 0)
        
        // Map to database field names (schema uses Ghana-centric names for backward compatibility)
        // Ensure values are never NaN or undefined (defensive programming)
        const ssnitEmployee = Number.isFinite(employeeStatutoryContributions) ? employeeStatutoryContributions : 0
        const ssnitEmployer = Number.isFinite(employerStatutoryContributions) ? employerStatutoryContributions : 0

        const breakdown = payrollResult.complianceBreakdown
        const bonusAmountSnapshot = Number(breakdown?.bonusAmount ?? 0)
        const overtimeAmountSnapshot = Number(breakdown?.overtimeAmount ?? 0)
        const regularAllowancesSnapshot = Number(breakdown?.regularAllowancesAmount ?? allowancesTotal)

        const bonusConcessionalSnapshot =
          breakdown && typeof breakdown.bonusConcessionalAmount === "number" && Number.isFinite(breakdown.bonusConcessionalAmount)
            ? Number(breakdown.bonusConcessionalAmount)
            : null
        const bonusGraduatedSnapshot =
          breakdown && typeof breakdown.bonusGraduatedAmount === "number" && Number.isFinite(breakdown.bonusGraduatedAmount)
            ? Number(breakdown.bonusGraduatedAmount)
            : null

        payrollEntries.push({
          staff_id: staff.id,
          basic_salary: payrollResult.earnings.basicSalary,
          allowances_total: payrollResult.earnings.allowances,
          regular_allowances_amount: regularAllowancesSnapshot,
          bonus_amount: bonusAmountSnapshot,
          overtime_amount: overtimeAmountSnapshot,
          deductions_total: payrollResult.totals.totalOtherDeductions,
          gross_salary: payrollResult.earnings.grossSalary,
          ssnit_employee: ssnitEmployee,
          ssnit_employer: ssnitEmployer,
          taxable_income: payrollResult.totals.taxableIncome,
          paye: paye,
          bonus_tax_5: Number(breakdown?.bonusTax5 ?? 0),
          bonus_tax_graduated: Number(breakdown?.bonusTaxGraduated ?? 0),
          overtime_tax_5: Number(breakdown?.overtimeTax5 ?? 0),
          overtime_tax_10: Number(breakdown?.overtimeTax10 ?? 0),
          overtime_tax_graduated: Number(breakdown?.overtimeTaxGraduated ?? 0),
          is_qualifying_junior_employee: Boolean(breakdown?.isQualifyingJuniorEmployee ?? false),
          bonus_cap_amount: Number(breakdown?.bonusCapAmount ?? 0),
          overtime_threshold_amount: Number(breakdown?.overtimeThresholdAmount ?? 0),
          pensionable_base: Number(breakdown?.ssnitBase ?? 0),
          employee_pension_contribution: Number(breakdown?.employeePensionContribution ?? ssnitEmployee),
          employer_pension_contribution: Number(breakdown?.employerPensionContribution ?? ssnitEmployer),
          total_mandatory_pension: Number(breakdown?.totalMandatoryPension ?? (ssnitEmployee + ssnitEmployer)),
          tier1_ssnit_remittance: Number(breakdown?.tier1SsnitRemittance ?? 0),
          tier2_pension_remittance: Number(breakdown?.tier2PensionRemittance ?? 0),
          /** Frozen at run creation for GRA DT 107A (Phase 2A); does not affect PAYE. */
          filing_tin: staff.tin_number != null ? String(staff.tin_number).trim() : null,
          filing_employee_name: staff.name != null ? String(staff.name).trim() : null,
          /** Ghana engine `complianceBreakdown` only; null for non-GH or missing breakdown. */
          bonus_concessional_amount: bonusConcessionalSnapshot,
          bonus_graduated_amount: bonusGraduatedSnapshot,
          payroll_tax_profile: breakdown
            ? buildPayrollTaxProfileSnapshotForEntry({
                breakdown,
                staffIsTaxResident,
                staffIsPensionable,
                graPositionCode,
                secondaryEmployment,
              })
            : null,
          net_salary: payrollResult.totals.netSalary,
        })

        const expectedGross = Number(staff.basic_salary || 0) + allowancesTotal
        if (Math.abs(Number(payrollResult.earnings.grossSalary || 0) - expectedGross) > 0.01) {
          return NextResponse.json(
            { error: `Payroll component reconciliation failed for ${staff.name || "staff"}: gross mismatch.` },
            { status: 400 }
          )
        }

        totalGross += payrollResult.earnings.grossSalary
        totalAllowances += payrollResult.earnings.allowances
        totalDeductions += payrollResult.totals.totalOtherDeductions
        totalSsnitEmployee += ssnitEmployee
        totalSsnitEmployer += ssnitEmployer
        totalPaye += paye
        totalNet += payrollResult.totals.netSalary

        for (const repayment of cappedAdvanceRepayments) {
          pendingRepaymentDrafts.push({
            staff_id: staff.id,
            salary_advance_id: repayment.salary_advance_id,
            amount: repayment.amount,
          })
        }
      } catch (error: any) {
        if (error instanceof MissingCountryError || error instanceof UnsupportedCountryError) {
          return NextResponse.json(
            { error: error.message },
            { status: 400 }
          )
        }
        throw error // Re-throw unexpected errors
      }
    }

    // Create payroll run
    const { data: payrollRun, error: runError } = await supabase
      .from("payroll_runs")
      .insert({
        business_id: business.id,
        payroll_month,
        status: "draft",
        total_gross_salary: totalGross,
        total_allowances: totalAllowances,
        total_deductions: totalDeductions,
        total_ssnit_employee: totalSsnitEmployee,
        total_ssnit_employer: totalSsnitEmployer,
        total_paye: totalPaye,
        total_net_salary: totalNet,
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

    const { data: createdEntries, error: entriesError } = await supabase
      .from("payroll_entries")
      .insert(entriesWithRunId)
      .select("id, staff_id")

    if (entriesError) {
      console.error("Error creating payroll entries:", entriesError)
      // Rollback payroll run
      await supabase.from("payroll_runs").delete().eq("id", payrollRun.id)
      return NextResponse.json(
        { error: entriesError.message },
        { status: 500 }
      )
    }

    if (pendingRepaymentDrafts.length > 0) {
      const entryIdByStaffId = new Map<string, string>()
      for (const entry of createdEntries || []) {
        entryIdByStaffId.set(String((entry as any).staff_id), String((entry as any).id))
      }

      const repaymentRows = pendingRepaymentDrafts
        .map((repayment) => {
          const payrollEntryId = entryIdByStaffId.get(repayment.staff_id)
          if (!payrollEntryId) return null
          return {
            business_id: business.id,
            salary_advance_id: repayment.salary_advance_id,
            staff_id: repayment.staff_id,
            payroll_run_id: payrollRun.id,
            payroll_entry_id: payrollEntryId,
            amount: repayment.amount,
            status: "pending" as const,
          }
        })
        .filter(Boolean)

      if (repaymentRows.length > 0) {
        const { error: repaymentsInsertError } = await supabase
          .from("salary_advance_repayments")
          .upsert(repaymentRows as any[], {
            onConflict: "salary_advance_id,payroll_run_id,payroll_entry_id",
            ignoreDuplicates: true,
          })

        if (repaymentsInsertError) {
          console.error("Error creating pending salary advance repayments:", repaymentsInsertError)
          await supabase.from("payroll_entries").delete().eq("payroll_run_id", payrollRun.id)
          await supabase.from("payroll_runs").delete().eq("id", payrollRun.id)
          return NextResponse.json(
            { error: repaymentsInsertError.message },
            { status: 500 }
          )
        }
      }
    }

    await logAudit({
      businessId: business.id,
      userId: user.id,
      actionType: "payroll.run_created",
      entityType: "payroll_run",
      entityId: payrollRun.id,
      newValues: {
        payroll_month,
        total_gross_salary: totalGross,
        total_net_salary: totalNet,
        staff_count: staffList.length,
        status: "draft",
      },
      description: `Created payroll run for ${payroll_month} (${staffList.length} staff, gross ${totalGross})`,
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


