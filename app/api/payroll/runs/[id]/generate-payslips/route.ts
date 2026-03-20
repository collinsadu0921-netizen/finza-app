import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"

export async function POST(
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

    const { allowed: canManagePayslips } = await requirePermission(
      supabase, user.id, business.id, PERMISSIONS.PAYROLL_PAYSLIPS
    )
    if (!canManagePayslips) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    // Verify payroll run belongs to business
    const { data: payrollRun } = await supabase
      .from("payroll_runs")
      .select("id, status")
      .eq("id", id)
      .eq("business_id", business.id)
      .single()

    if (!payrollRun) {
      return NextResponse.json(
        { error: "Payroll run not found" },
        { status: 404 }
      )
    }

    if (payrollRun.status === "draft") {
      return NextResponse.json(
        { error: "Payroll must be approved before payslips can be generated." },
        { status: 400 }
      )
    }

    // Get all payroll entries for this run
    const { data: entries, error: entriesError } = await supabase
      .from("payroll_entries")
      .select("*")
      .eq("payroll_run_id", id)

    if (entriesError) {
      console.error("Error fetching payroll entries:", entriesError)
      return NextResponse.json(
        { error: entriesError.message },
        { status: 500 }
      )
    }

    // Generate payslips for each entry
    const payslips = []
    for (const entry of entries || []) {
      // Check if payslip already exists for this entry
      const { data: existingPayslip } = await supabase
        .from("payslips")
        .select("id")
        .eq("payroll_entry_id", entry.id)
        .maybeSingle()

      if (existingPayslip) {
        continue // Skip if already exists
      }

      // Generate public token
      const { data: tokenData } = await supabase.rpc("generate_payslip_token")
      const publicToken = tokenData || Buffer.from(`${entry.id}-${Date.now()}`).toString("base64url")

      const { data: payslip, error: payslipError } = await supabase
        .from("payslips")
        .insert({
          payroll_entry_id: entry.id,
          staff_id: entry.staff_id,
          payroll_run_id: id,
          public_token: publicToken,
        })
        .select()
        .single()

      if (payslipError) {
        console.error("Error creating payslip:", payslipError)
        continue
      }

      payslips.push(payslip)
    }

    return NextResponse.json({
      message: `Generated ${payslips.length} payslips`,
      payslips,
    })
  } catch (error: any) {
    console.error("Error generating payslips:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


