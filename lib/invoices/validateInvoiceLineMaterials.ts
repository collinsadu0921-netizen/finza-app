import type { SupabaseClient } from "@supabase/supabase-js"
import { isBillableMaterialRow } from "@/lib/service/materialBillableList"

export type InvoiceLineWithMaterial = {
  material_id?: string | null
}

const MATERIAL_SELECT =
  "id, is_active, is_billable, default_selling_price"

export type ValidateInvoiceLineMaterialsResult =
  | { ok: true; validMaterialIds: Set<string> }
  | { ok: false; error: string; status: number }

/**
 * Validates material_id references for invoice lines.
 * Does not read cost fields, update stock, or create movements.
 */
export async function validateInvoiceLineMaterials(
  supabase: SupabaseClient,
  businessId: string,
  items: InvoiceLineWithMaterial[]
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

  const { data, error } = await supabase
    .from("service_material_inventory")
    .select(MATERIAL_SELECT)
    .eq("business_id", businessId)
    .in("id", requestedIds)

  if (error) {
    return { ok: false, error: error.message, status: 500 }
  }

  const rowsById = new Map((data ?? []).map((row) => [row.id as string, row]))
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
    if (!isBillableMaterialRow(row as Parameters<typeof isBillableMaterialRow>[0])) {
      return {
        ok: false,
        error: "One or more materials are inactive or not available for invoicing.",
        status: 400,
      }
    }
    validMaterialIds.add(id)
  }

  return { ok: true, validMaterialIds }
}

export type InvoiceItemInput = {
  product_service_id?: string | null
  product_id?: string | null
  material_id?: string | null
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

    return {
      invoice_id: invoiceId,
      product_service_id,
      material_id,
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
