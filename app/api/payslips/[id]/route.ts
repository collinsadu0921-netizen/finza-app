import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
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

    // Get payslip with related data
    const { data: payslip, error: payslipError } = await supabase
      .from("payslips")
      .select(
        `
        *,
        payroll_entries (
          *,
          staff (
            *
          )
        ),
        payroll_runs (
          *
        )
      `
      )
      .eq("id", id)
      .single()

    if (payslipError || !payslip) {
      return NextResponse.json(
        { error: "Payslip not found" },
        { status: 404 }
      )
    }

    // Verify business ownership
    const payrollRun = payslip.payroll_runs
    if (payrollRun.business_id !== business.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      )
    }

    return NextResponse.json({ payslip })
  } catch (error: any) {
    console.error("Error fetching payslip:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


