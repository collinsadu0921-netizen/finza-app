import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

/**
 * GET /api/service/jobs/billable-material-usages
 * Eligible job material usages for invoice job_usage lines.
 * Query: business_id?, customer_id?, job_id?, material_id?
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const url = new URL(request.url)
    const bodyBusinessId = url.searchParams.get("business_id")
    const customerId = url.searchParams.get("customer_id")
    const jobId = url.searchParams.get("job_id")
    const materialId = url.searchParams.get("material_id")
    const excludeInvoiceId = url.searchParams.get("exclude_invoice_id")

    const scope = await resolveBusinessScopeForUser(supabase, user.id, bodyBusinessId)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const denied = await enforceServiceIndustryMinTier(
      supabase,
      user.id,
      scope.businessId,
      "professional"
    )
    if (denied) return denied

    let jobQuery = supabase
      .from("service_jobs")
      .select("id, customer_id, invoice_id, status")
      .eq("business_id", scope.businessId)

    if (customerId) jobQuery = jobQuery.eq("customer_id", customerId)
    if (jobId) jobQuery = jobQuery.eq("id", jobId)

    const { data: jobs, error: jobsErr } = await jobQuery
    if (jobsErr) {
      return NextResponse.json({ error: jobsErr.message }, { status: 500 })
    }

    const jobIds = (jobs ?? []).map((j) => j.id)
    if (jobIds.length === 0) {
      return NextResponse.json({ usages: [] })
    }

    const jobById = new Map((jobs ?? []).map((j) => [j.id, j]))

    let usageQuery = supabase
      .from("service_job_material_usage")
      .select(
        "id, job_id, material_id, quantity_used, unit_cost, total_cost, status, created_at, service_material_inventory(id, name, unit)"
      )
      .eq("business_id", scope.businessId)
      .in("job_id", jobIds)
      .neq("status", "returned")
      .order("created_at", { ascending: false })

    if (materialId) usageQuery = usageQuery.eq("material_id", materialId)

    const { data: usages, error: usageErr } = await usageQuery
    if (usageErr) {
      return NextResponse.json({ error: usageErr.message }, { status: 500 })
    }

    const enriched = []
    for (const usage of usages ?? []) {
      const { data: billedQty } = await supabase.rpc("invoice_job_usage_billed_quantity", {
        p_usage_id: usage.id,
        p_exclude_invoice_id: excludeInvoiceId || null,
      })
      const consumed = Number(usage.quantity_used ?? 0)
      const billed = Number(billedQty ?? 0)
      const remaining = Math.max(0, Math.round((consumed - billed) * 10000) / 10000)
      if (remaining <= 0) continue

      const job = jobById.get(usage.job_id)
      const mat = usage.service_material_inventory as
        | { id: string; name: string; unit: string }
        | { id: string; name: string; unit: string }[]
        | null
      const material = Array.isArray(mat) ? mat[0] : mat

      enriched.push({
        id: usage.id,
        job_id: usage.job_id,
        material_id: usage.material_id,
        material_name: material?.name ?? null,
        material_unit: material?.unit ?? null,
        quantity_used: consumed,
        quantity_billed: billed,
        quantity_remaining_billable: remaining,
        unit_cost: usage.unit_cost,
        total_cost: usage.total_cost,
        status: usage.status,
        job_status: job?.status ?? null,
        job_invoice_id: job?.invoice_id ?? null,
        created_at: usage.created_at,
      })
    }

    return NextResponse.json({ usages: enriched })
  } catch (err: unknown) {
    console.error("billable-material-usages error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
