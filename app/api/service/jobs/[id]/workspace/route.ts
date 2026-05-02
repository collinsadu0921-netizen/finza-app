import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

/**
 * GET /api/service/jobs/[id]/workspace
 * Bundle for project detail: job, usages, materials, customers, proformas.
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

    const [jobRes, proformaRes, usageRes, matRes, custRes] = await Promise.all([
      supabase
        .from("service_jobs")
        .select(
          "id, business_id, customer_id, title, description, status, start_date, end_date, invoice_id, proforma_invoice_id, materials_reversed, created_at, customers(name, email, phone)"
        )
        .eq("id", jobId)
        .eq("business_id", business.id)
        .single(),
      supabase
        .from("proforma_invoices")
        .select("id, proforma_number, customers(name)")
        .eq("business_id", business.id)
        .in("status", ["sent", "accepted"])
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("service_job_material_usage")
        .select(
          "id, material_id, quantity_used, unit_cost, total_cost, status, created_at, service_material_inventory(name, unit)"
        )
        .eq("job_id", jobId)
        .eq("business_id", business.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("service_material_inventory")
        .select("id, name, unit, quantity_on_hand, average_cost")
        .eq("business_id", business.id)
        .eq("is_active", true)
        .order("name"),
      supabase.from("customers").select("id, name").eq("business_id", business.id).order("name"),
    ])

    if (jobRes.error || !jobRes.data) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    return NextResponse.json({
      job: jobRes.data,
      proformas: proformaRes.data ?? [],
      usages: usageRes.data ?? [],
      materials: matRes.data ?? [],
      customers: custRes.data ?? [],
      usageError: usageRes.error?.message ?? null,
    })
  } catch (err: unknown) {
    console.error("GET /api/service/jobs/[id]/workspace:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
