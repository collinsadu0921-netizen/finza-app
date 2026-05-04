import "server-only"

import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"

type SaleItemRow = {
  product_id?: string
  productId?: string
  variant_id?: string | null
  variantId?: string | null
}

/**
 * Ensures cart lines and optional customer belong to the token business (defense in depth;
 * sale engine also scopes by business_id from token).
 */
export async function assertPosTokenSaleReferencesAllowed(
  admin: SupabaseClient,
  businessId: string,
  body: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const saleItems = body.sale_items
  if (!Array.isArray(saleItems) || saleItems.length === 0) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Sale items are required", code: "EMPTY_CART" }, { status: 400 }),
    }
  }

  const productIds = new Set<string>()
  const variantIds = new Set<string>()
  for (const row of saleItems as SaleItemRow[]) {
    const pid = row?.product_id || row?.productId
    if (typeof pid === "string" && pid.length > 0) productIds.add(pid)
    const vid = row?.variant_id || row?.variantId
    if (typeof vid === "string" && vid.length > 0) variantIds.add(vid)
  }

  if (productIds.size === 0) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Each line must include a product", code: "INVALID_CART" }, { status: 400 }),
    }
  }

  const { data: prodRows, error: pErr } = await admin
    .from("products")
    .select("id")
    .eq("business_id", businessId)
    .in("id", [...productIds])

  if (pErr || !prodRows || prodRows.length !== productIds.size) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    }
  }

  if (variantIds.size > 0) {
    const { data: varRows, error: vErr } = await admin
      .from("products_variants")
      .select("id, product_id")
      .in("id", [...variantIds])

    if (vErr || !varRows || varRows.length !== variantIds.size) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Not found" }, { status: 404 }),
      }
    }

    const variantProductIds = new Set(varRows.map((r) => r.product_id as string))
    const { data: vpRows, error: vpErr } = await admin
      .from("products")
      .select("id")
      .eq("business_id", businessId)
      .in("id", [...variantProductIds])

    if (vpErr || !vpRows || vpRows.length !== variantProductIds.size) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Not found" }, { status: 404 }),
      }
    }
  }

  const customerId = body.customer_id
  if (customerId != null && String(customerId).trim() !== "") {
    const cid = String(customerId)
    const { data: cust, error: cErr } = await admin
      .from("customers")
      .select("id")
      .eq("id", cid)
      .eq("business_id", businessId)
      .maybeSingle()

    if (cErr || !cust) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Not found" }, { status: 404 }),
      }
    }
  }

  return { ok: true }
}
