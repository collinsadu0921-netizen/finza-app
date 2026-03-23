import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"

/**
 * Legacy path: same behaviour as GET /api/payroll/payslips/public/[token].
 * Uses service role; RLS no longer exposes payslips by public_token alone.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 })
  }

  try {
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
          deductions_total,
          gross_salary,
          ssnit_employee,
          ssnit_employer,
          taxable_income,
          paye,
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

    const run = payslip.payroll_runs as { business_id?: string } | null
    const { data: business } = await supabase
      .from("businesses")
      .select("id, legal_name, trading_name, phone, email, address_line1, address_city, address_country, default_currency")
      .eq("id", run?.business_id ?? "")
      .single()

    return NextResponse.json({ payslip, business })
  } catch (err: any) {
    console.error("Error fetching public payslip:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
