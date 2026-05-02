import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

/**
 * GET /api/service/jobs/workspace
 * List projects + raw usage rows for KPI aggregation (Service workspace).
 */
export async function GET() {
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

    const denied = await enforceServiceIndustryMinTier(supabase, user.id, business.id, "professional")
    if (denied) return denied

    const [{ data: jobs, error: jobErr }, { data: usages, error: usageErr }] = await Promise.all([
      supabase
        .from("service_jobs")
        .select(
          "id, customer_id, title, status, start_date, end_date, created_at, customers(name)"
        )
        .eq("business_id", business.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("service_job_material_usage")
        .select("job_id, total_cost")
        .eq("business_id", business.id),
    ])

    if (jobErr) {
      console.error("service_jobs list:", jobErr)
      return NextResponse.json({ error: jobErr.message }, { status: 500 })
    }
    if (usageErr) {
      console.error("service_job_material_usage list:", usageErr)
      return NextResponse.json({ error: usageErr.message }, { status: 500 })
    }

    return NextResponse.json({
      jobs: jobs ?? [],
      usageRows: usages ?? [],
    })
  } catch (err: unknown) {
    console.error("GET /api/service/jobs/workspace:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
