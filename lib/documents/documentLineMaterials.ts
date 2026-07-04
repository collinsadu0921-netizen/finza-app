import type { SupabaseClient } from "@supabase/supabase-js"
import {
  validateInvoiceLineMaterials,
  validateConversionLineMaterials,
  mapInvoiceItemsForInsert,
  type InvoiceItemInput,
} from "@/lib/invoices/validateInvoiceLineMaterials"
import { pickEstimateItemProductServiceId } from "@/lib/estimates/pickEstimateItemProductServiceId"

export {
  validateInvoiceLineMaterials as validateDocumentLineMaterials,
  validateConversionLineMaterials,
  mapInvoiceItemsForInsert,
}

export type DocumentLineWithMaterial = {
  material_id?: string | null
}

export type ConversionSourceLine = {
  material_id?: string | null
  product_service_id?: string | null
  product_id?: string | null
  description?: string
  qty?: number
  quantity?: number
  unit_price?: number
  price?: number
  discount_amount?: number
  line_subtotal?: number
  line_total?: number
  total?: number
}

/** Map quote/proforma line to invoice input using snapshotted source values only. */
export function mapConversionSourceLineToInvoiceInput(
  line: ConversionSourceLine
): InvoiceItemInput {
  const qty = Number(line.qty ?? line.quantity ?? 0)
  const unit_price = Number(line.unit_price ?? line.price ?? 0)
  const discount_amount = Number(line.discount_amount ?? 0)
  const explicitSubtotal = Number(line.line_subtotal ?? line.line_total ?? line.total ?? NaN)

  return {
    material_id: line.material_id ?? null,
    product_service_id: line.product_service_id ?? line.product_id ?? null,
    description: line.description || "",
    qty,
    unit_price,
    discount_amount,
    line_subtotal: Number.isFinite(explicitSubtotal)
      ? explicitSubtotal
      : Math.round(Math.max(0, qty * unit_price - discount_amount) * 100) / 100,
  }
}

export function buildConversionInvoiceItems(
  invoiceId: string,
  sourceLines: ConversionSourceLine[],
  validProductServiceIds: Set<string>,
  validMaterialIds: Set<string>
) {
  const inputs = sourceLines.map(mapConversionSourceLineToInvoiceInput)
  return mapInvoiceItemsForInsert(invoiceId, inputs, validProductServiceIds, validMaterialIds)
}

export async function resolveValidProductServiceIds(
  supabase: SupabaseClient,
  items: Array<{ product_service_id?: unknown; product_id?: unknown }>
): Promise<Set<string>> {
  const candidateIds = [
    ...new Set(
      items
        .map((item) => item.product_service_id || item.product_id)
        .filter(Boolean)
        .map(String)
    ),
  ] as string[]

  if (candidateIds.length === 0) return new Set()

  const { data: validRows } = await supabase
    .from("products_services")
    .select("id")
    .in("id", candidateIds)

  return new Set((validRows ?? []).map((r) => r.id as string))
}

function resolveMaterialId(
  item: { material_id?: unknown },
  validMaterialIds: Set<string>
): string | null {
  const raw = item.material_id != null ? String(item.material_id).trim() : ""
  return raw && validMaterialIds.has(raw) ? raw : null
}

function resolveProductServiceId(
  item: InvoiceItemInput,
  validProductServiceIds: Set<string>,
  material_id: string | null
): string | null {
  if (material_id != null) return null
  const rawId = pickEstimateItemProductServiceId(item)
  return rawId && validProductServiceIds.has(rawId) ? rawId : null
}

export type EstimateLineInput = InvoiceItemInput & {
  quantity?: number
  price?: number
  total?: number
}

export function mapEstimateItemsForInsert(
  estimateId: string,
  items: EstimateLineInput[],
  validProductServiceIds: Set<string>,
  validMaterialIds: Set<string>
) {
  return items.map((item) => {
    const material_id = resolveMaterialId(item, validMaterialIds)
    const product_service_id = resolveProductServiceId(
      item,
      validProductServiceIds,
      material_id
    )

    const qty = Number(item.qty ?? item.quantity) || 0
    const price = Number(item.unit_price ?? item.price) || 0
    const discount = Number(item.discount_amount) || 0
    const total =
      item.total != null
        ? Number(item.total)
        : Math.round(Math.max(0, qty * price - discount) * 100) / 100

    const row: Record<string, unknown> = {
      estimate_id: estimateId,
      description: item.description || "",
      quantity: qty,
      price,
      total: Math.round(Math.max(0, total) * 100) / 100,
      discount_amount: discount,
      material_id,
    }
    if (product_service_id) {
      row.product_service_id = product_service_id
    }
    return row
  })
}

export function mapProformaItemsForInsert(
  proformaId: string,
  items: InvoiceItemInput[],
  validProductServiceIds: Set<string>,
  validMaterialIds: Set<string>
) {
  return items.map((item) => {
    const material_id = resolveMaterialId(item, validMaterialIds)
    const product_service_id = resolveProductServiceId(
      item,
      validProductServiceIds,
      material_id
    )

    const qty = Number(item.qty) || 0
    const unit_price = Number(item.unit_price) || 0
    const discount_amount = Number(item.discount_amount) || 0

    return {
      proforma_invoice_id: proformaId,
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
