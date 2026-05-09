import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 })
  }

  try {
    // Use admin client (service role) so RLS does not block joins on
    // payroll_entries, staff, payroll_runs for unauthenticated requests.
    // Access is controlled by the public_token itself.
    const supabase = createSupabaseAdminClient()

    const { data: payslip, error } = await supabase
      .from("payslips")
      .select(`
        id,
        public_token,
        sent_at,
        created_at,
        payroll_entries (
          id,
          basic_salary,
          allowances_total,
          regular_allowances_amount,
          bonus_amount,
          overtime_amount,
          deductions_total,
          gross_salary,
          ssnit_employee,
          ssnit_employer,
          taxable_income,
          paye,
          bonus_tax_5,
          bonus_tax_graduated,
          overtime_tax_5,
          overtime_tax_10,
          overtime_tax_graduated,
          net_salary
        ),
        staff (
          id,
          name,
          position,
          bank_name,
          bank_account,
          ssnit_number,
          tin_number
        ),
        payroll_runs (
          id,
          payroll_month,
          status,
          business_id
        )
      `)
      .eq("public_token", token)
      .single()

    if (error || !payslip) {
      return NextResponse.json({ error: "Payslip not found" }, { status: 404 })
    }

    const payrollEntryId = (payslip as any)?.payroll_entries?.id
    const payrollRun = (payslip as any)?.payroll_runs
    const businessId = payrollRun?.business_id

    // Fetch salary advance repayments for this exact payroll entry only
    const { data: salaryAdvanceRepayments } = payrollEntryId
      ? await supabase
          .from("salary_advance_repayments")
          .select(`
            id,
            salary_advance_id,
            payroll_run_id,
            payroll_entry_id,
            amount,
            status,
            journal_entry_id,
            posted_at,
            created_at,
            salary_advance:salary_advance_id (
              id,
              amount,
              repaid_amount,
              status
            )
          `)
          .eq("business_id", businessId)
          .eq("payroll_entry_id", payrollEntryId)
          .in("status", ["pending", "posted"])
          .order("created_at", { ascending: false })
      : { data: [] as any[] }

    const normalizedRepayments = (salaryAdvanceRepayments || []).map((repayment: any) => {
      const advance = repayment.salary_advance as any
      const amount = Number(advance?.amount || 0)
      const repaidAmount = Number(advance?.repaid_amount || 0)
      const remainingBalance = repayment.status === "posted"
        ? Math.max(0, amount - repaidAmount)
        : Math.max(0, amount - repaidAmount - Number(repayment.amount || 0))
      return {
        id: repayment.id,
        salary_advance_id: repayment.salary_advance_id,
        payroll_run_id: repayment.payroll_run_id,
        payroll_entry_id: repayment.payroll_entry_id,
        amount: Number(repayment.amount || 0),
        status: repayment.status,
        journal_entry_id: repayment.journal_entry_id,
        posted_at: repayment.posted_at,
        created_at: repayment.created_at,
        remaining_balance: remainingBalance,
      }
    })

    const salaryAdvanceRepaymentAmount = normalizedRepayments.reduce(
      (sum, repayment) => sum + Number(repayment.amount || 0),
      0
    )
    const salaryAdvanceRemainingBalance = normalizedRepayments.reduce(
      (sum, repayment) => sum + Number(repayment.remaining_balance || 0),
      0
    )

    const enrichedPayslip = {
      ...(payslip as any),
      salary_advance_repayment_amount: salaryAdvanceRepaymentAmount,
      salary_advance_remaining_balance: salaryAdvanceRemainingBalance,
      salary_advance_repayments: normalizedRepayments,
    }

    // Fetch business info separately
    const run = payslip.payroll_runs as any
    const { data: business } = await supabase
      .from("businesses")
      .select("id, legal_name, trading_name, phone, email, address_line1, address_city, address_country, default_currency")
      .eq("id", run?.business_id)
      .single()

    return NextResponse.json({ payslip: enrichedPayslip, business })
  } catch (err: any) {
    console.error("Error fetching public payslip:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
