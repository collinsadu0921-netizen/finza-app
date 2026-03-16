import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const supabase = await createSupabaseServerClient()

    // Get payslip by public token
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
          *,
          businesses (
            *
          )
        )
      `
      )
      .eq("public_token", token)
      .single()

    if (payslipError || !payslip) {
      return NextResponse.json(
        { error: "Payslip not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({ payslip })
  } catch (error: any) {
    console.error("Error fetching public payslip:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


