import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

type ReceiveLineInput = {
  purchase_order_item_id: string
  quantity_received: number
  received_unit_cost: number
}

/**
 * POST /api/purchase-orders/[id]/receive
 * Thin route: validates auth/business and delegates full transactional receipt
 * processing to process_retail_purchase_order_receipt RPC.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: poId } = await params
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

    const body = (await request.json().catch(() => ({}))) as {
      store_id?: string | null
      lines?: Array<{
        id?: string
        purchase_order_item_id?: string
        quantity_received?: number
        received_unit_cost?: number
      }>
    }

    const storeId = body.store_id?.trim() || null
    const linesIn = Array.isArray(body.lines) ? body.lines : []

    if (!storeId) {
      return NextResponse.json(
        { error: "store_id is required to receive into a store location." },
        { status: 400 }
      )
    }
    const normalizedLines: ReceiveLineInput[] = linesIn.map((line) => ({
      purchase_order_item_id: String(line.purchase_order_item_id || line.id || "").trim(),
      quantity_received: Number(line.quantity_received ?? 0),
      received_unit_cost: Number(line.received_unit_cost ?? 0),
    }))

    if (normalizedLines.length === 0) {
      return NextResponse.json({ error: "Provide at least one line in `lines`." }, { status: 400 })
    }

    if (normalizedLines.some((line) => !line.purchase_order_item_id)) {
      return NextResponse.json(
        { error: "Each line requires purchase_order_item_id (or legacy id)." },
        { status: 400 }
      )
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "process_retail_purchase_order_receipt",
      {
        p_business_id: business.id,
        p_purchase_order_id: poId,
        p_store_id: storeId,
        p_actor_user_id: user.id,
        p_lines: normalizedLines,
      }
    )

    if (rpcError) {
      const message = rpcError.message || "Failed to process purchase order receipt"
      const status = /PO_NOT_FOUND|LINE_NOT_IN_PO/i.test(message)
        ? 404
        : /PO_ALREADY_RECEIVED|PO_STATUS_NOT_RECEIVABLE|NEGATIVE_DELTA_NOT_ALLOWED|RECEIVED_QTY_OUT_OF_RANGE|RECEIVED_UNIT_COST_REQUIRED|INVALID_LINES_PAYLOAD|DUPLICATE_LINE_IDS|INVALID_STORE_FOR_BUSINESS|NO_RECEIPT_DELTA/i.test(message)
          ? 400
          : /PO_BUSINESS_MISMATCH/i.test(message)
            ? 403
            : 500
      const clientMessage = /NO_RECEIPT_DELTA/i.test(message)
        ? "No new received quantity was provided."
        : message
      return NextResponse.json({ error: clientMessage }, { status })
    }

    if (!rpcData) {
      return NextResponse.json({ error: "No response from receipt processor RPC" }, { status: 500 })
    }

    return NextResponse.json(rpcData)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal server error"
    console.error("receive PO:", error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
