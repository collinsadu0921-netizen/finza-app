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
  type InvoiceMaterialReturnResult,
} from "@/lib/invoices/invoiceMaterialFulfilmentErrors"

/**
 * POST /api/invoices/[id]/return-materials
 * Return previously fulfilled direct_sale quantities.
 * Body: { fulfilment_id, quantity, idempotency_key?, return_date?, business_id? }
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
      fulfilment_id: fulfilmentId,
      quantity,
      idempotency_key: bodyIdempotencyKey,
      return_date: bodyReturnDate,
    } = body as {
      business_id?: string
      fulfilment_id?: string
      quantity?: number
      idempotency_key?: string
      return_date?: string
    }

    if (!fulfilmentId) {
      return NextResponse.json(
        { error: "fulfilment_id is required", code: "VALIDATION_ERROR" },
        { status: 400 }
      )
    }

    const qty = Number(quantity)
    if (!(qty > 0)) {
      return NextResponse.json(
        { error: "quantity must be positive", code: "VALIDATION_ERROR" },
        { status: 400 }
      )
    }

    const { data: invoiceCheck } = await supabase
      .from("invoices")
      .select("id, business_id, deleted_at")
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

    const { data: fulfilment } = await supabase
      .from("invoice_material_fulfilments")
      .select("id, invoice_id, business_id")
      .eq("id", fulfilmentId)
      .eq("business_id", scope.businessId)
      .maybeSingle()

    if (!fulfilment || fulfilment.invoice_id !== invoiceId) {
      return NextResponse.json(
        { error: "Fulfilment not found on this invoice", code: "FULFILMENT_NOT_FOUND" },
        { status: 404 }
      )
    }

    const returnDate =
      typeof bodyReturnDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(bodyReturnDate.trim())
        ? bodyReturnDate.trim()
        : new Date().toISOString().slice(0, 10)

    const idempotencyKey =
      typeof bodyIdempotencyKey === "string" && bodyIdempotencyKey.trim()
        ? bodyIdempotencyKey.trim()
        : randomUUID()

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "return_invoice_material_fulfilment",
      {
        p_business_id: scope.businessId,
        p_fulfilment_id: fulfilmentId,
        p_quantity: qty,
        p_idempotency_key: idempotencyKey,
        p_returned_by: user.id,
        p_return_date: returnDate,
      }
    )

    if (rpcError) {
      const mapped = mapInvoiceMaterialFulfilRpcError(rpcError.message)
      return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status })
    }

    if (!rpcResult || typeof rpcResult !== "object") {
      return NextResponse.json(
        { error: "Material return failed", code: "INVOICE_MATERIAL_RETURN_FAILED" },
        { status: 500 }
      )
    }

    const result = rpcResult as InvoiceMaterialReturnResult

    await logAudit({
      businessId: scope.businessId,
      userId: user.id,
      actionType: "invoice.material_returned",
      entityType: "invoice_material_fulfilment_return",
      entityId: result.return_id,
      newValues: {
        invoice_id: invoiceId,
        fulfilment_id: fulfilmentId,
        quantity: result.quantity,
        total_cost: result.total_cost,
        movement_id: result.movement_id,
        journal_entry_id: result.journal_entry_id,
        idempotent: result.idempotent ?? false,
        idempotency_key: idempotencyKey,
      },
      description: "Invoice material fulfilment returned to stock",
      request,
    })

    if (!result.idempotent) {
      fireAfterAccountingPost({
        businessId: scope.businessId,
        journalDate: returnDate,
        source: "invoice_material_fulfilment_return",
        supabase,
        scheduleBackground: (p) => waitUntil(p),
      })
    }

    return NextResponse.json({
      success: true,
      result,
      idempotent: result.idempotent ?? false,
    })
  } catch (err: unknown) {
    console.error("Invoice return materials error:", err)
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Internal server error",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    )
  }
}
