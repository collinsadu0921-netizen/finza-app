import type { SupabaseClient } from "@supabase/supabase-js"
import { isBillableMaterialRow } from "@/lib/service/materialBillableList"

export type MaterialInventorySource = "direct_sale" | "job_usage" | "legacy_unclassified"

export type InvoiceLineWithMaterial = {
  material_id?: string | null
  material_inventory_source?: string | null
  job_material_usage_id?: string | null
  qty?: number
}

const MATERIAL_SELECT =
  "id, is_active, is_billable, default_selling_price"

const CONVERSION_MATERIAL_SELECT = "id"

export type ValidateInvoiceLineMaterialsResult =
  | { ok: true; validMaterialIds: Set<string> }
  | { ok: false; error: string; status: number }

async function validateMaterialIdsForBusiness(
  supabase: SupabaseClient,
  businessId: string,
  items: InvoiceLineWithMaterial[],
  options: { requireBillable: boolean }
): Promise<ValidateInvoiceLineMaterialsResult> {
  const requestedIds = [
    ...new Set(
      items
        .map((item) => (item.material_id != null ? String(item.material_id).trim() : ""))
        .filter(Boolean)
    ),
  ] as string[]

  if (requestedIds.length === 0) {
    return { ok: true, validMaterialIds: new Set() }
  }

  const selectColumns = options.requireBillable ? MATERIAL_SELECT : CONVERSION_MATERIAL_SELECT
  const { data, error } = await supabase
    .from("service_material_inventory")
    .select(selectColumns)
    .eq("business_id", businessId)
    .in("id", requestedIds)

  if (error) {
    return { ok: false, error: error.message, status: 500 }
  }

  type MaterialValidationRow = {
    id: string
    is_active?: boolean
    is_billable?: boolean
    default_selling_price?: number | null
  }

  const rowsById = new Map(
    ((data ?? []) as unknown as MaterialValidationRow[]).map((row) => [row.id, row])
  )
  const validMaterialIds = new Set<string>()

  for (const id of requestedIds) {
    const row = rowsById.get(id)
    if (!row) {
      return {
        ok: false,
        error: "One or more materials are invalid or belong to another business.",
        status: 400,
      }
    }
    if (
      options.requireBillable &&
      !isBillableMaterialRow(row as Parameters<typeof isBillableMaterialRow>[0])
    ) {
      return {
        ok: false,
        error: "One or more materials are inactive or not available on customer documents.",
        status: 400,
      }
    }
    validMaterialIds.add(id)
  }

  return { ok: true, validMaterialIds }
}

/**
 * Validates material_id + inventory source for invoice lines.
 * Does not update stock or create movements.
 */
export async function validateInvoiceLineMaterials(
  supabase: SupabaseClient,
  businessId: string,
  items: InvoiceLineWithMaterial[],
  options?: { excludeInvoiceId?: string | null }
): Promise<ValidateInvoiceLineMaterialsResult> {
  const materialResult = await validateMaterialIdsForBusiness(supabase, businessId, items, {
    requireBillable: true,
  })
  if (!materialResult.ok) return materialResult

  // Detect duplicate job_usage allocation within the same payload
  const usageQtyInPayload = new Map<string, number>()

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const rawMaterialId = item.material_id != null ? String(item.material_id).trim() : ""
    if (!rawMaterialId) continue

    const source = String(item.material_inventory_source ?? "")
      .trim()
      .toLowerCase()

    if (source !== "direct_sale" && source !== "job_usage") {
      return {
        ok: false,
        error: `Material line ${i + 1}: choose how this material is supplied (sell from stock, or already used on a job).`,
        status: 400,
      }
    }

    if (source === "direct_sale") {
      if (item.job_material_usage_id) {
        return {
          ok: false,
          error: `Material line ${i + 1}: direct stock sales cannot link a job usage.`,
          status: 400,
        }
      }
      continue
    }

    const usageId =
      item.job_material_usage_id != null ? String(item.job_material_usage_id).trim() : ""
    if (!usageId) {
      return {
        ok: false,
        error: `Material line ${i + 1}: select the job material usage that already consumed this stock.`,
        status: 400,
      }
    }

    const { data: usage, error: usageErr } = await supabase
      .from("service_job_material_usage")
      .select("id, business_id, material_id, quantity_used, status, job_id")
      .eq("id", usageId)
      .eq("business_id", businessId)
      .maybeSingle()

    if (usageErr) {
      return { ok: false, error: usageErr.message, status: 500 }
    }
    if (!usage) {
      return {
        ok: false,
        error: `Material line ${i + 1}: job material usage not found for this business.`,
        status: 400,
      }
    }
    if (String(usage.material_id) !== rawMaterialId) {
      return {
        ok: false,
        error: `Material line ${i + 1}: selected job usage is for a different material.`,
        status: 400,
      }
    }
    if (String(usage.status) === "returned") {
      return {
        ok: false,
        error: `Material line ${i + 1}: cannot bill a returned job usage.`,
        status: 400,
      }
    }

    const qty = Number(item.qty) || 0
    if (qty <= 0) {
      return {
        ok: false,
        error: `Material line ${i + 1}: quantity must be positive.`,
        status: 400,
      }
    }

    const priorInPayload = usageQtyInPayload.get(usageId) ?? 0
    usageQtyInPayload.set(usageId, priorInPayload + qty)

    const { data: billedQty, error: billedErr } = await supabase.rpc(
      "invoice_job_usage_billed_quantity",
      {
        p_usage_id: usageId,
        p_exclude_invoice_id: options?.excludeInvoiceId ?? null,
      }
    )
    if (billedErr) {
      return {
        ok: false,
        error: billedErr.message || "Unable to validate job usage allocation.",
        status: 500,
      }
    }
    const alreadyBilled = Number(billedQty ?? 0)
    const remaining = Number(usage.quantity_used) - alreadyBilled
    const requestedTotal = priorInPayload + qty
    if (requestedTotal > remaining + 0.000001) {
      return {
        ok: false,
        error: `Material line ${i + 1}: quantity ${requestedTotal} exceeds remaining billable job usage (${remaining}).`,
        status: 400,
      }
    }
  }

  return materialResult
}

/**
 * Validates material_id for document conversion flows.
 * Only checks tenant ownership — saved lines may reference inactive materials.
 * Does not require source (conversion may preserve legacy).
 */
export async function validateConversionLineMaterials(
  supabase: SupabaseClient,
  businessId: string,
  items: InvoiceLineWithMaterial[]
): Promise<ValidateInvoiceLineMaterialsResult> {
  return validateMaterialIdsForBusiness(supabase, businessId, items, {
    requireBillable: false,
  })
}

export type InvoiceItemInput = {
  product_service_id?: string | null
  product_id?: string | null
  material_id?: string | null
  material_inventory_source?: string | null
  job_material_usage_id?: string | null
  description?: string
  qty?: number
  unit_price?: number
  discount_amount?: number
  line_subtotal?: number
}

export function mapInvoiceItemsForInsert(
  invoiceId: string,
  items: InvoiceItemInput[],
  validProductServiceIds: Set<string>,
  validMaterialIds: Set<string>
) {
  return items.map((item) => {
    const rawMaterialId =
      item.material_id != null ? String(item.material_id).trim() : ""
    const material_id =
      rawMaterialId && validMaterialIds.has(rawMaterialId) ? rawMaterialId : null

    const rawId = item.product_service_id || item.product_id || null
    const product_service_id =
      material_id != null
        ? null
        : rawId && validProductServiceIds.has(rawId)
          ? rawId
          : null

    const qty = Number(item.qty) || 0
    const unit_price = Number(item.unit_price) || 0
    const discount_amount = Number(item.discount_amount) || 0

    let material_inventory_source: string | null = null
    let job_material_usage_id: string | null = null

    if (material_id != null) {
      const source = String(item.material_inventory_source ?? "")
        .trim()
        .toLowerCase()
      if (source === "direct_sale" || source === "job_usage") {
        material_inventory_source = source
      } else if (source === "legacy_unclassified") {
        material_inventory_source = "legacy_unclassified"
      } else {
        // Conversion / unspecified: never auto-promote to direct_sale
        material_inventory_source = "legacy_unclassified"
      }
      if (source === "job_usage") {
        const usageId =
          item.job_material_usage_id != null
            ? String(item.job_material_usage_id).trim()
            : ""
        job_material_usage_id = usageId || null
      }
    }

    return {
      invoice_id: invoiceId,
      product_service_id,
      material_id,
      material_inventory_source,
      job_material_usage_id,
      description: item.description || "",
      qty,
      unit_price,
      discount_amount,
      line_subtotal:
        item.line_subtotal != null
          ? Number(item.line_subtotal)
          : Math.round((qty * unit_price - discount_amount) * 100) / 100,
    }
  })
}
