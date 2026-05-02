import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { calculatePayroll } from "@/lib/payrollEngine"
import { MissingCountryError, UnsupportedCountryError } from "@/lib/payrollEngine/errors"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { logAudit } from "@/lib/auditLog"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

function isQualifyingJuniorEmployee(staff: { employment_type?: string | null; position?: string | null }): boolean {
  const employmentType = String(staff.employment_type || "").toLowerCase()
  const position = String(staff.position || "").toLowerCase()
  return employmentType.includes("junior") || position.includes("junior")
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

    // Calculate payroll for each staff using payroll engine
    const payrollEntries = []
    let totalGross = 0
    let totalAllowances = 0
    let totalDeductions = 0
    let totalSsnitEmployee = 0
    let totalSsnitEmployer = 0
    let totalPaye = 0
    let totalNet = 0

    for (const staff of staffList) {
      // Get allowances:
      // - include all allowance rows (recurring and non-recurring)
      // - split bonus/overtime explicitly for Ghana tax bucket handling
      const { data: allowances } = await supabase
        .from("allowances")
        .select("type, amount, recurring")
        .eq("staff_id", staff.id)
        .is("deleted_at", null)

      const bonusAmount = allowances
        ?.filter((a: any) => String(a.type || "").toLowerCase() === "bonus")
        .reduce((sum, a: any) => sum + Number(a.amount || 0), 0) || 0
      const overtimeAmount = allowances
        ?.filter((a: any) => String(a.type || "").toLowerCase() === "overtime")
        .reduce((sum, a: any) => sum + Number(a.amount || 0), 0) || 0
      const regularAllowances = allowances
        ?.filter((a: any) => {
          const type = String(a.type || "").toLowerCase()
          return type !== "bonus" && type !== "overtime"
        })
        .reduce((sum, a: any) => sum + Number(a.amount || 0), 0) || 0
      const allowancesTotal = regularAllowances + bonusAmount + overtimeAmount

      // Get deductions (other deductions, not statutory) - include recurring and non-recurring
      const { data: deductions } = await supabase
        .from("deductions")
        .select("amount")
        .eq("staff_id", staff.id)
        .is("deleted_at", null)

      const deductionsTotal = deductions?.reduce((sum, d) => sum + Number(d.amount || 0), 0) || 0

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
            isQualifyingJuniorEmployee: isQualifyingJuniorEmployee(staff),
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


