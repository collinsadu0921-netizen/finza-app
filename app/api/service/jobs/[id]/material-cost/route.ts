import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

/**
 * GET /api/service/jobs/[id]/material-cost
 * Sum of recorded material usage costs for invoice preview (service workspace).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id: jobId } = await Promise.resolve(context.params)

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

    const { data, error } = await supabase
      .from("service_job_material_usage")
      .select("total_cost")
      .eq("job_id", jobId)
      .eq("business_id", business.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const total = ((data ?? []) as { total_cost: number | null }[]).reduce(
      (s, r) => s + Number(r.total_cost ?? 0),
      0
    )

    return NextResponse.json({ total_material_cost: total })
  } catch (err: unknown) {
    console.error("GET /api/service/jobs/[id]/material-cost:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
