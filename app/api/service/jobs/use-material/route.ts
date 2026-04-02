import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { logAudit } from "@/lib/auditLog"

/**
 * POST /api/service/jobs/use-material
 * Allocate material to a job: deduct stock, insert movement (job_usage),
 * insert service_job_material_usage with status 'allocated'.
 * Ledger posts when usage status is later updated to 'consumed' (trigger).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { business_id: bodyBusinessId, job_id, material_id, quantity_used } = body as {
      business_id?: string
      job_id?: string
      material_id?: string
      quantity_used?: number
    }

    if (!job_id || !material_id) {
      return NextResponse.json({ error: "job_id and material_id are required" }, { status: 400 })
    }

    const scope = await resolveBusinessScopeForUser(supabase, user.id, bodyBusinessId ?? null)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const businessId = scope.businessId

    const qty = Number(quantity_used)
    if (isNaN(qty) || qty <= 0) {
      return NextResponse.json({ error: "quantity_used must be a positive number" }, { status: 400 })
    }

    const { data: material, error: matErr } = await supabase
      .from("service_material_inventory")
      .select("id, business_id, name, quantity_on_hand, average_cost")
      .eq("id", material_id)
      .eq("business_id", businessId)
      .single()

    if (matErr || !material) {
      return NextResponse.json({ error: "Material not found" }, { status: 404 })
    }

    const onHand = Number(material.quantity_on_hand ?? 0)
    if (onHand < qty) {
      return NextResponse.json(
        { error: `Insufficient stock. On hand: ${onHand}, requested: ${qty}` },
        { status: 400 }
      )
    }

    const { data: job, error: jobErr } = await supabase
      .from("service_jobs")
      .select("id, business_id")
      .eq("id", job_id)
      .eq("business_id", businessId)
      .single()

    if (jobErr || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 })
    }

    const unitCost = Number(material.average_cost ?? 0)
    const totalCost = qty * unitCost
    const newQty = onHand - qty

    const { error: updateErr } = await supabase
      .from("service_material_inventory")
      .update({
        quantity_on_hand: newQty,
        updated_at: new Date().toISOString(),
      })
      .eq("id", material_id)
      .eq("business_id", businessId)

    if (updateErr) {
      console.error("Use material: deduct stock error", updateErr)
      return NextResponse.json({ error: "Failed to deduct stock" }, { status: 500 })
    }

    const { error: movErr } = await supabase.from("service_material_movements").insert({
      business_id: businessId,
      material_id,
      movement_type: "job_usage",
      quantity: qty,
      unit_cost: unitCost,
      reference_id: job_id,
    })

    if (movErr) {
      console.error("Use material: movement insert error", movErr)
      return NextResponse.json({ error: "Failed to record movement" }, { status: 500 })
    }

    const { error: usageErr } = await supabase.from("service_job_material_usage").insert({
      business_id: businessId,
      job_id,
      material_id,
      quantity_used: qty,
      unit_cost: unitCost,
      total_cost: totalCost,
      status: "allocated",
    })

    if (usageErr) {
      console.error("Use material: usage insert error", usageErr)
      return NextResponse.json({ error: "Failed to record usage" }, { status: 500 })
    }

    await logAudit({
      businessId,
      userId: user.id,
      actionType: "service_job.material_allocated",
      entityType: "service_job_material_usage",
      entityId: job_id,
      newValues: {
        job_id,
        material_id,
        quantity_used: qty,
        total_cost: qty * Number(material.average_cost ?? 0),
      },
      description: "Material allocated to service project",
      request,
    })

    return NextResponse.json({
      success: true,
      quantity_on_hand: newQty,
      total_cost: qty * Number(material.average_cost ?? 0),
    })
  } catch (err: any) {
    console.error("Use material error:", err)
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    )
  }
}
