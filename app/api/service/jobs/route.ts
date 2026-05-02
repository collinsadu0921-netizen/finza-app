import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

/**
 * POST /api/service/jobs
 * Create a service project (service_jobs row).
 */
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

    const denied = await enforceServiceIndustryMinTier(supabase, user.id, business.id, "professional")
    if (denied) return denied

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const {
      title,
      description = null,
      customer_id = null,
      status = "draft",
      start_date = null,
      end_date = null,
      proforma_invoice_id = null,
    } = body as Record<string, unknown>

    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 })
    }

    const { data: job, error } = await supabase
      .from("service_jobs")
      .insert({
        business_id: business.id,
        title: title.trim(),
        description: description != null ? String(description).trim() || null : null,
        customer_id: customer_id || null,
        status: typeof status === "string" ? status : "draft",
        start_date: start_date || null,
        end_date: end_date || null,
        proforma_invoice_id: proforma_invoice_id || null,
      })
      .select("id")
      .single()

    if (error || !job) {
      console.error("create service_jobs:", error)
      return NextResponse.json({ error: error?.message || "Failed to create project" }, { status: 500 })
    }

    return NextResponse.json({ id: job.id }, { status: 201 })
  } catch (err: unknown) {
    console.error("POST /api/service/jobs:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
