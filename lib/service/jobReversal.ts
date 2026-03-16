import type { SupabaseClient } from "@supabase/supabase-js"

type UsageRow = {
  id: string
  material_id: string
  quantity_used: number
  unit_cost: number
  total_cost: number
}

/**
 * Restore material stock and reverse COGS for a service job.
 * Used by: job cancel API and credit-note apply (when invoice linked to cancelled job).
 * Does NOT set job status — caller sets status = 'cancelled' when cancelling.
 * Idempotent: returns error "Materials already reversed." if materials_reversed is true.
 */
export async function performServiceJobReversal(
  supabase: SupabaseClient,
  businessId: string,
  jobId: string
): Promise<{ error?: string }> {
  const { data: job, error: jobErr } = await supabase
    .from("service_jobs")
    .select("id, materials_reversed")
    .eq("id", jobId)
    .eq("business_id", businessId)
    .single()

  if (jobErr || !job) {
    return { error: "Job not found" }
  }

  if ((job as { materials_reversed?: boolean }).materials_reversed === true) {
    return { error: "Materials already reversed." }
  }

  const { data: usages, error: usagesErr } = await supabase
    .from("service_job_material_usage")
    .select("id, material_id, quantity_used, unit_cost, total_cost")
    .eq("job_id", jobId)
    .eq("business_id", businessId)

  if (usagesErr) {
    console.error("jobReversal: fetch usages", usagesErr)
    return { error: "Failed to load job usage" }
  }

  const rows = (usages || []) as UsageRow[]

  for (const u of rows) {
    const qty = Number(u.quantity_used)
    if (qty <= 0) continue

    const { data: inv } = await supabase
      .from("service_material_inventory")
      .select("id, quantity_on_hand")
      .eq("id", u.material_id)
      .eq("business_id", businessId)
      .single()

    if (!inv) continue

    const onHand = Number((inv as { quantity_on_hand?: number }).quantity_on_hand ?? 0)
    const newQty = onHand + qty

    const { error: updateErr } = await supabase
      .from("service_material_inventory")
      .update({
        quantity_on_hand: newQty,
        updated_at: new Date().toISOString(),
      })
      .eq("id", u.material_id)
      .eq("business_id", businessId)

    if (updateErr) {
      console.error("jobReversal: restore stock", updateErr)
      return { error: "Failed to restore stock" }
    }

    const { error: movErr } = await supabase.from("service_material_movements").insert({
      business_id: businessId,
      material_id: u.material_id,
      movement_type: "return",
      quantity: qty,
      unit_cost: Number(u.unit_cost ?? 0),
      reference_id: jobId,
    })

    if (movErr) {
      console.error("jobReversal: insert return movement", movErr)
      return { error: "Failed to record return movement" }
    }
  }

  const { error: rpcErr } = await supabase.rpc("reverse_service_job_cogs", {
    p_job_id: jobId,
  })

  if (rpcErr) {
    console.error("jobReversal: COGS reversal RPC", rpcErr)
    return { error: "Failed to reverse COGS" }
  }

  const { error: flagErr } = await supabase
    .from("service_jobs")
    .update({
      materials_reversed: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("business_id", businessId)

  if (flagErr) {
    console.error("jobReversal: set materials_reversed", flagErr)
    return { error: "Failed to update job" }
  }

  return {}
}
