import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

type ReceiveLineInput = {
  id: string
  quantity_received: number
  received_unit_cost: number
}

/**
 * POST /api/purchase-orders/[id]/receive
 * Record physical receipt: optional partial lines, then stock.
 * When every line is fully received with costs, sets status received and posts Inventory/AP journal.
 * Partial receipts update stock only (no journal) until fully received.
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
      lines?: ReceiveLineInput[]
    }

    const storeId = body.store_id?.trim() || null
    const linesIn = Array.isArray(body.lines) ? body.lines : []

    if (!storeId) {
      return NextResponse.json(
        { error: "store_id is required to receive into a store location." },
        { status: 400 }
      )
    }

    const { data: store, error: storeError } = await supabase
      .from("stores")
      .select("id")
      .eq("id", storeId)
      .eq("business_id", business.id)
      .single()

    if (storeError || !store) {
      return NextResponse.json({ error: "Invalid store for this business." }, { status: 400 })
    }

    const { data: po, error: poError } = await supabase
      .from("purchase_orders")
      .select(
        `
        *,
        items:purchase_order_items(*)
      `
      )
      .eq("id", poId)
      .eq("business_id", business.id)
      .single()

    if (poError || !po) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 })
    }

    const status = String(po.status)
    if (status === "received" || status === "cancelled" || status === "paid") {
      return NextResponse.json(
        { error: `Cannot receive when status is ${status}.` },
        { status: 400 }
      )
    }
    if (!["ordered", "partially_received"].includes(status)) {
      return NextResponse.json(
        {
          error:
            "Mark the buy list as ordered first, then record goods when they arrive (ordered or partially_received).",
        },
        { status: 400 }
      )
    }

    const items = (po.items || []) as Array<{
      id: string
      product_id: string
      variant_id: string | null
      quantity: number
      quantity_received: number | null
    }>

    if (items.length === 0) {
      return NextResponse.json({ error: "Purchase order has no lines." }, { status: 400 })
    }

    const lineById = new Map(items.map((i) => [i.id, i]))
    const updates: ReceiveLineInput[] = []

    for (const raw of linesIn) {
      const row = lineById.get(raw.id)
      if (!row) {
        return NextResponse.json({ error: `Unknown line id: ${raw.id}` }, { status: 400 })
      }
      const q = Number(raw.quantity_received)
      const c = Number(raw.received_unit_cost)
      if (!Number.isFinite(q) || q < 0) {
        return NextResponse.json({ error: "quantity_received must be >= 0" }, { status: 400 })
      }
      const ordered = Number(row.quantity)
      if (q > ordered + 1e-6) {
        return NextResponse.json(
          { error: `Received qty cannot exceed ordered qty for line ${row.id}.` },
          { status: 400 }
        )
      }
      if (q > 0 && (!Number.isFinite(c) || c <= 0)) {
        return NextResponse.json(
          { error: "received_unit_cost must be greater than 0 when quantity_received > 0." },
          { status: 400 }
        )
      }
      updates.push({ id: raw.id, quantity_received: q, received_unit_cost: q > 0 ? c : 0 })
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "Provide at least one line in `lines`." }, { status: 400 })
    }

    // Apply stock deltas from previous quantity_received on updated lines only
    for (const u of updates) {
      const row = lineById.get(u.id)!
      const prev = Number(row.quantity_received ?? 0)
      const delta = u.quantity_received - prev
      if (delta === 0) continue

      const stockQuery = supabase
        .from("products_stock")
        .select("id, stock_quantity, stock")
        .eq("product_id", row.product_id)
        .eq("store_id", storeId)

      if (row.variant_id) {
        stockQuery.eq("variant_id", row.variant_id)
      } else {
        stockQuery.is("variant_id", null)
      }

      const { data: stockData, error: stockError } = await stockQuery.maybeSingle()

      if (stockError) {
        return NextResponse.json({ error: `Failed to read stock for product ${row.product_id}` }, { status: 500 })
      }

      if (stockData) {
        const cur = Number(stockData.stock_quantity ?? stockData.stock ?? 0)
        const newStock = cur + delta
        const { error: upErr } = await supabase
          .from("products_stock")
          .update({ stock_quantity: newStock, stock: newStock })
          .eq("id", stockData.id)
        if (upErr) {
          return NextResponse.json({ error: upErr.message || "Stock update failed" }, { status: 500 })
        }
      } else if (delta > 0) {
        const { error: insErr } = await supabase.from("products_stock").insert({
          product_id: row.product_id,
          variant_id: row.variant_id || null,
          store_id: storeId,
          stock_quantity: delta,
          stock: delta,
        })
        if (insErr) {
          return NextResponse.json({ error: insErr.message || "Could not create stock row" }, { status: 500 })
        }
      }
    }

    for (const u of updates) {
      const row = lineById.get(u.id)!
      const q = u.quantity_received
      const cost = q > 0 ? u.received_unit_cost : null
      const { error: liErr } = await supabase
        .from("purchase_order_items")
        .update({
          quantity_received: q,
          received_unit_cost: cost,
        })
        .eq("id", u.id)
        .eq("purchase_order_id", poId)

      if (liErr) {
        return NextResponse.json({ error: liErr.message || "Failed to update line" }, { status: 500 })
      }
      row.quantity_received = q
    }

    const { data: refreshed } = await supabase
      .from("purchase_order_items")
      .select("id, quantity, quantity_received, received_unit_cost")
      .eq("purchase_order_id", poId)

    const refreshedItems = refreshed || []
    let fully = true
    for (const r of refreshedItems) {
      const ord = Number(r.quantity)
      const rec = Number(r.quantity_received ?? 0)
      if (Math.abs(ord - rec) > 1e-6) {
        fully = false
        break
      }
    }

    let receiptValue = 0
    for (const r of refreshedItems) {
      const rec = Number(r.quantity_received ?? 0)
      const c = r.received_unit_cost != null ? Number(r.received_unit_cost) : NaN
      if (rec > 0) {
        if (!Number.isFinite(c) || c < 0) {
          fully = false
          break
        }
        receiptValue += rec * c
      }
    }

    const nextStatus = fully && receiptValue > 0 ? "received" : "partially_received"

    const baseUpdate: Record<string, unknown> = {
      status: nextStatus,
    }
    if (nextStatus === "received") {
      baseUpdate.received_by = user.id
      baseUpdate.received_at = new Date().toISOString()
    }

    const { data: updatedPO, error: poUpErr } = await supabase
      .from("purchase_orders")
      .update(baseUpdate)
      .eq("id", poId)
      .select()
      .single()

    if (poUpErr || !updatedPO) {
      return NextResponse.json({ error: poUpErr?.message || "Failed to update purchase order" }, { status: 500 })
    }

    let journalId: string | null = null
    if (nextStatus === "received") {
      const { data: jid, error: ledgerError } = await supabase.rpc("post_purchase_order_receipt_to_ledger", {
        p_purchase_order_id: poId,
      })
      if (ledgerError) {
        console.error("Ledger post failed:", ledgerError)
        return NextResponse.json(
          {
            error: `Stock updated but accounting post failed: ${ledgerError.message}.`,
            warning: "Inventory was increased; fix accounting with support if needed.",
            purchase_order: updatedPO,
          },
          { status: 500 }
        )
      }
      journalId = jid as string
    }

    return NextResponse.json({
      success: true,
      purchase_order: updatedPO,
      journal_id: journalId,
      receipt_complete: nextStatus === "received",
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal server error"
    console.error("receive PO:", error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
