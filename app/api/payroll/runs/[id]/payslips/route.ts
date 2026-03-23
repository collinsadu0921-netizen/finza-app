import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const { allowed } = await requirePermission(
      supabase,
      user.id,
      business.id,
      PERMISSIONS.PAYROLL_VIEW
    )
    if (!allowed) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    // Verify run belongs to business
    const { data: run } = await supabase
      .from("payroll_runs")
      .select("id")
      .eq("id", id)
      .eq("business_id", business.id)
      .single()

    if (!run) {
      return NextResponse.json({ error: "Payroll run not found" }, { status: 404 })
    }

    const { data: payslips, error } = await supabase
      .from("payslips")
      .select("id, staff_id, public_token, sent_via_whatsapp, sent_via_email, sent_at, whatsapp_sent_at, email_sent_at")
      .eq("payroll_run_id", id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ payslips: payslips ?? [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 })
  }
}
