import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { waitUntil } from "@vercel/functions"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { logAudit } from "@/lib/auditLog"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { fireAfterAccountingPost } from "@/lib/server/fireAfterAccountingPost"
import {
  mapInvoiceMaterialFulfilRpcError,
  type InvoiceMaterialFulfilResult,
} from "@/lib/invoices/invoiceMaterialFulfilmentErrors"

/**
 * POST /api/invoices/[id]/fulfil-materials
 * Fulfil direct_sale material lines via fulfil_invoice_material_line RPC.
 * Body: { business_id?, lines: [{ invoice_item_id, quantity }], idempotency_key? }
 * Or single: { invoice_item_id, quantity, idempotency_key? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: invoiceId } = await params
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const {
      business_id: bodyBusinessId,
      invoice_item_id: singleItemId,
      quantity: singleQty,
      lines: bodyLines,
      idempotency_key: bodyIdempotencyKey,
      fulfilment_date: bodyDate,
    } = body as {
      business_id?: string
      invoice_item_id?: string
      quantity?: number
      lines?: Array<{ invoice_item_id?: string; quantity?: number; idempotency_key?: string }>
      idempotency_key?: string
      fulfilment_date?: string
    }

    const { data: invoiceCheck } = await supabase
      .from("invoices")
      .select("id, business_id, status, deleted_at")
      .eq("id", invoiceId)
      .maybeSingle()

    if (!invoiceCheck || invoiceCheck.deleted_at) {
      return NextResponse.json({ error: "Invoice not found", code: "NOT_FOUND" }, { status: 404 })
    }

    const role = await getUserRole(supabase, user.id, invoiceCheck.business_id)
    if (!role) {
      return NextResponse.json({ error: "Invoice not found", code: "NOT_FOUND" }, { status: 404 })
    }

    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      bodyBusinessId ?? invoiceCheck.business_id
    )
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error, code: "BUSINESS_SCOPE" }, { status: scope.status })
    }
    if (scope.businessId !== invoiceCheck.business_id) {
      return NextResponse.json({ error: "Cross-tenant reference blocked.", code: "CROSS_TENANT" }, { status: 403 })
    }

    const denied = await enforceServiceIndustryMinTier(
      supabase,
      user.id,
      scope.businessId,
      "professional"
    )
    if (denied) return denied

    const fulfilmentDate =
      typeof bodyDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(bodyDate.trim())
        ? bodyDate.trim()
        : new Date().toISOString().slice(0, 10)

    const lines: Array<{ invoice_item_id: string; quantity: number; idempotency_key: string }> = []
    if (Array.isArray(bodyLines) && bodyLines.length > 0) {
      for (const line of bodyLines) {
        const itemId = line.invoice_item_id != null ? String(line.invoice_item_id).trim() : ""
        const qty = Number(line.quantity)
        if (!itemId || !(qty > 0)) continue
        lines.push({
          invoice_item_id: itemId,
          quantity: qty,
          idempotency_key:
            typeof line.idempotency_key === "string" && line.idempotency_key.trim()
              ? line.idempotency_key.trim()
              : typeof bodyIdempotencyKey === "string" && bodyIdempotencyKey.trim()
                ? `${bodyIdempotencyKey.trim()}:${itemId}`
                : randomUUID(),
        })
      }
    } else if (singleItemId) {
      const qty = Number(singleQty)
      if (!(qty > 0)) {
        return NextResponse.json(
          { error: "quantity must be positive", code: "VALIDATION_ERROR" },
          { status: 400 }
        )
      }
      lines.push({
        invoice_item_id: String(singleItemId).trim(),
        quantity: qty,
        idempotency_key:
          typeof bodyIdempotencyKey === "string" && bodyIdempotencyKey.trim()
            ? bodyIdempotencyKey.trim()
            : randomUUID(),
      })
    }

    if (lines.length === 0) {
      return NextResponse.json(
        { error: "Provide invoice_item_id + quantity, or lines[]", code: "VALIDATION_ERROR" },
        { status: 400 }
      )
    }

    const results: InvoiceMaterialFulfilResult[] = []
    for (const line of lines) {
      const { data: rpcResult, error: rpcError } = await supabase.rpc("fulfil_invoice_material_line", {
        p_business_id: scope.businessId,
        p_invoice_item_id: line.invoice_item_id,
        p_quantity: line.quantity,
        p_idempotency_key: line.idempotency_key,
        p_created_by: user.id,
        p_fulfilment_date: fulfilmentDate,
      })

      if (rpcError) {
        const mapped = mapInvoiceMaterialFulfilRpcError(rpcError.message)
        return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status })
      }

      if (!rpcResult || typeof rpcResult !== "object") {
        return NextResponse.json(
          { error: "Fulfilment failed", code: "INVOICE_MATERIAL_FULFIL_FAILED" },
          { status: 500 }
        )
      }

      const result = rpcResult as InvoiceMaterialFulfilResult
      results.push(result)

      await logAudit({
        businessId: scope.businessId,
        userId: user.id,
        actionType: "invoice.material_fulfilled",
        entityType: "invoice_material_fulfilment",
        entityId: result.fulfilment_id,
        newValues: {
          invoice_id: invoiceId,
          invoice_item_id: line.invoice_item_id,
          quantity: result.quantity,
          total_cost: result.total_cost,
          movement_id: result.movement_id,
          journal_entry_id: result.journal_entry_id,
          idempotent: result.idempotent ?? false,
          idempotency_key: line.idempotency_key,
        },
        description: "Invoice material fulfilled from stock",
        request,
      })

      if (!result.idempotent) {
        fireAfterAccountingPost({
          businessId: scope.businessId,
          journalDate: fulfilmentDate,
          source: "invoice_material_fulfilment",
          supabase,
          scheduleBackground: (p) => waitUntil(p),
        })
      }
    }

    return NextResponse.json({
      success: true,
      results,
      idempotent: results.every((r) => r.idempotent),
    })
  } catch (err: unknown) {
    console.error("Invoice fulfil materials error:", err)
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Internal server error",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    )
  }
}
