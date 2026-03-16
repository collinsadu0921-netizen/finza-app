import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { performServiceJobReversal } from "@/lib/service/jobReversal"

/**
 * POST /api/service/jobs/[id]/cancel
 * Cancel a service job: restore material stock, insert return movements,
 * reverse COGS, set status = cancelled and materials_reversed = true.
 * Returns 400 if materials already reversed.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(context.params)
    const jobId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const { data: job, error: jobErr } = await supabase
      .from("service_jobs")
      .select("id, status, materials_reversed")
      .eq("id", jobId)
      .eq("business_id", business.id)
      .single()

    if (jobErr || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 })
    }

    if ((job as { materials_reversed?: boolean }).materials_reversed === true) {
      return NextResponse.json(
        { error: "Materials already reversed." },
        { status: 400 }
      )
    }

    const result = await performServiceJobReversal(supabase, business.id, jobId)
    if (result.error) {
      const status = result.error === "Materials already reversed." ? 400 : 500
      return NextResponse.json({ error: result.error }, { status })
    }

    const { error: statusErr } = await supabase
      .from("service_jobs")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("business_id", business.id)

    if (statusErr) {
      console.error("Cancel job: set status", statusErr)
      return NextResponse.json({ error: "Failed to update job status" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    console.error("Cancel job error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
