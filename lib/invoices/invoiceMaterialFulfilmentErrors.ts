/**
 * Maps fulfil_invoice_material_line / return_invoice_material_fulfilment RPC errors.
 */

export function mapInvoiceMaterialFulfilRpcError(message: string): {
  status: number
  code: string
  error: string
} {
  const msg = message ?? "Invoice material fulfilment failed"

  const codeMatch = msg.match(
    /\b(FULFIL_INVALID_ARGS|FULFIL_INVALID_QTY|FULFIL_IDEMPOTENCY_CONFLICT|FULFIL_QTY_EXCEEDS_REMAINING|FULFIL_SOURCE_INVALID|INVOICE_ITEM_NOT_FOUND|INVOICE_NOT_FOUND|INVOICE_DELETED|INVOICE_NOT_ISSUED|INVOICE_TERMINAL|NOT_MATERIAL_LINE|JOB_USAGE_NO_FULFIL|LEGACY_SOURCE_REQUIRED|INSUFFICIENT_STOCK|MATERIAL_NOT_FOUND|CROSS_TENANT|ACCOUNT_CONFIGURATION_REQUIRED|PERIOD_LOCKED|RETURN_INVALID_ARGS|RETURN_INVALID_QTY|RETURN_IDEMPOTENCY_CONFLICT|RETURN_QTY_EXCEEDS_UNRETURNED|FULFILMENT_NOT_FOUND|RETURN_NOT_FOUND|UNDO_RETURN_INVALID_ARGS|UNDO_RETURN_INVALID_QTY|UNDO_RETURN_IDEMPOTENCY_CONFLICT|UNDO_RETURN_NOTHING_LEFT|UNDO_RETURN_QTY_EXCEEDS_UNDOABLE|INVOICE_HAS_ACTIVE_FULFILMENTS|INVOICE_JOB_USAGE_OVER_ALLOCATED|INVOICE_MATERIAL_SOURCE_REQUIRED|INVOICE_JOB_USAGE_REQUIRED)\b/
  )
  const code = codeMatch?.[1]

  switch (code) {
    case "INSUFFICIENT_STOCK":
      return {
        status: 400,
        code,
        error: msg.replace(/^[A-Z_]+:\s*/, ""),
      }
    case "INVOICE_NOT_ISSUED":
    case "INVOICE_TERMINAL":
    case "INVOICE_DELETED":
    case "JOB_USAGE_NO_FULFIL":
    case "LEGACY_SOURCE_REQUIRED":
    case "FULFIL_SOURCE_INVALID":
    case "FULFIL_QTY_EXCEEDS_REMAINING":
    case "RETURN_QTY_EXCEEDS_UNRETURNED":
    case "UNDO_RETURN_NOTHING_LEFT":
    case "UNDO_RETURN_QTY_EXCEEDS_UNDOABLE":
    case "INVOICE_HAS_ACTIVE_FULFILMENTS":
    case "INVOICE_JOB_USAGE_OVER_ALLOCATED":
    case "INVOICE_MATERIAL_SOURCE_REQUIRED":
    case "INVOICE_JOB_USAGE_REQUIRED":
      return { status: 400, code, error: msg.replace(/^[A-Z_]+:\s*/, "") }
    case "CROSS_TENANT":
      return { status: 403, code, error: "Cross-tenant reference blocked." }
    case "PERIOD_LOCKED":
      return {
        status: 403,
        code,
        error: "Accounting period is locked; fulfilment cannot post.",
      }
    case "ACCOUNT_CONFIGURATION_REQUIRED":
      return { status: 422, code, error: msg.replace(/^[A-Z_]+:\s*/, "") }
    case "INVOICE_ITEM_NOT_FOUND":
    case "INVOICE_NOT_FOUND":
    case "MATERIAL_NOT_FOUND":
    case "FULFILMENT_NOT_FOUND":
    case "RETURN_NOT_FOUND":
      return { status: 404, code, error: msg.replace(/^[A-Z_]+:\s*/, "") }
    case "FULFIL_IDEMPOTENCY_CONFLICT":
    case "RETURN_IDEMPOTENCY_CONFLICT":
    case "UNDO_RETURN_IDEMPOTENCY_CONFLICT":
      return { status: 409, code, error: msg.replace(/^[A-Z_]+:\s*/, "") }
    case "FULFIL_INVALID_ARGS":
    case "FULFIL_INVALID_QTY":
    case "RETURN_INVALID_ARGS":
    case "RETURN_INVALID_QTY":
    case "UNDO_RETURN_INVALID_ARGS":
    case "UNDO_RETURN_INVALID_QTY":
    case "NOT_MATERIAL_LINE":
      return { status: 400, code: code ?? "VALIDATION_ERROR", error: msg.replace(/^[A-Z_]+:\s*/, "") }
    default:
      if (/period.*closed|locked|soft_closed/i.test(msg)) {
        return { status: 403, code: "PERIOD_LOCKED", error: msg }
      }
      return { status: 500, code: "INVOICE_MATERIAL_FULFIL_FAILED", error: msg }
  }
}

export type InvoiceMaterialFulfilResult = {
  fulfilment_id: string
  invoice_item_id: string
  invoice_id: string
  material_id: string
  material_name?: string
  quantity: number
  unit_cost: number
  total_cost: number
  movement_id: string | null
  journal_entry_id: string | null
  quantity_on_hand?: number
  remaining_unfulfilled?: number
  status: string
  idempotent: boolean
}

export type InvoiceMaterialReturnResult = {
  return_id: string
  fulfilment_id: string
  quantity: number
  unit_cost: number
  total_cost: number
  movement_id: string | null
  journal_entry_id: string | null
  quantity_on_hand?: number
  quantity_returned_total?: number
  idempotent: boolean
}

export type InvoiceMaterialUndoReturnResult = {
  undo_id: string
  return_id: string
  fulfilment_id: string
  invoice_id?: string
  invoice_item_id?: string
  material_id?: string
  quantity: number
  unit_cost: number
  total_cost: number
  movement_id: string | null
  journal_entry_id: string | null
  quantity_on_hand?: number
  quantity_undone_total?: number
  quantity_returned_total?: number
  idempotent: boolean
}
