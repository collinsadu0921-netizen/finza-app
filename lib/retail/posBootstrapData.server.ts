import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { CashierPosTokenPayload } from "@/lib/cashierPosToken.server"
import type { RetailPosBootstrapPayload } from "@/lib/retail/posBootstrapTypes"

export type PosBootstrapResult =
  | { ok: true; payload: RetailPosBootstrapPayload }
  | { ok: false; status: number; message: string }

/**
 * Load POS bootstrap data for a verified cashier POS token. All reads use service-role client;
 * scope is strictly claims.businessId / claims.storeId / claims.cashierId.
 */
export async function loadPosBootstrapPayload(
  admin: SupabaseClient,
  claims: CashierPosTokenPayload
): Promise<PosBootstrapResult> {
  const businessId = claims.businessId
  const storeId = claims.storeId
  const cashierId = claims.cashierId

  const { data: userRow, error: userErr } = await admin
    .from("users")
    .select("id, store_id, full_name")
    .eq("id", cashierId)
    .maybeSingle()

  if (userErr || !userRow || String((userRow as { store_id?: string | null }).store_id ?? "") !== storeId) {
    return { ok: false, status: 404, message: "Not found" }
  }

  const { data: buRow, error: buErr } = await admin
    .from("business_users")
    .select("role")
    .eq("business_id", businessId)
    .eq("user_id", cashierId)
    .maybeSingle()

  if (buErr || !buRow || String((buRow as { role?: string }).role) !== "cashier") {
    return { ok: false, status: 404, message: "Not found" }
  }

  const { data: storeRow, error: storeErr } = await admin
    .from("stores")
    .select("id, name, business_id")
    .eq("id", storeId)
    .eq("business_id", businessId)
    .maybeSingle()

  if (storeErr || !storeRow) {
    return { ok: false, status: 404, message: "Not found" }
  }

  const { data: businessRow, error: bizErr } = await admin
    .from("businesses")
    .select("id, name, legal_name, trading_name, address_country, default_currency")
    .eq("id", businessId)
    .maybeSingle()

  if (bizErr || !businessRow) {
    return { ok: false, status: 404, message: "Not found" }
  }

  const b = businessRow as {
    id: string
    name?: string | null
    legal_name?: string | null
    trading_name?: string | null
    address_country?: string | null
    default_currency?: string | null
  }
  const displayName =
    (b.trading_name && String(b.trading_name).trim()) ||
    (b.name && String(b.name).trim()) ||
    (b.legal_name && String(b.legal_name).trim()) ||
    null

  const { data: registers, error: regErr } = await admin
    .from("registers")
    .select("id, name, store_id, business_id")
    .eq("business_id", businessId)
    .eq("store_id", storeId)
    .order("created_at", { ascending: true })

  if (regErr) {
    return { ok: false, status: 500, message: "Server error" }
  }

  const { data: sessions, error: sessErr } = await admin
    .from("cashier_sessions")
    .select(
      `
      id,
      register_id,
      user_id,
      store_id,
      started_at,
      opening_float,
      registers ( id, name ),
      stores ( name )
    `
    )
    .eq("business_id", businessId)
    .eq("store_id", storeId)
    .eq("status", "open")
    .order("started_at", { ascending: false })

  if (sessErr) {
    return { ok: false, status: 500, message: "Server error" }
  }

  const productSelect =
    "id, business_id, name, price, stock_quantity, stock, low_stock_threshold, track_stock, barcode, category_id, image_url, tax_category"

  const { data: productRows, error: prodErr } = await admin
    .from("products")
    .select(productSelect)
    .eq("business_id", businessId)
    .order("name", { ascending: true })

  if (prodErr) {
    return { ok: false, status: 500, message: "Server error" }
  }

  const allProducts = (productRows || []) as Record<string, unknown>[]
  const productIds = allProducts.map((p) => String(p.id))

  let stockRows: Array<{
    product_id: string
    variant_id: string | null
    stock?: number | null
    stock_quantity?: number | null
    store_id?: string | null
  }> = []

  if (productIds.length > 0) {
    const { data: sRows, error: stErr } = await admin
      .from("products_stock")
      .select("product_id, variant_id, stock, stock_quantity, store_id")
      .in("product_id", productIds)
      .eq("store_id", storeId)

    if (stErr) {
      return { ok: false, status: 500, message: "Server error" }
    }
    stockRows = (sRows || []) as typeof stockRows
  }

  const productsWithVariantIds = new Set<string>()
  if (productIds.length > 0) {
    const { data: vPid } = await admin.from("products_variants").select("product_id").in("product_id", productIds)
    for (const row of vPid || []) {
      const pid = (row as { product_id?: string }).product_id
      if (pid) productsWithVariantIds.add(pid)
    }
  }

  let variants: RetailPosBootstrapPayload["variants"] = []
  if (productIds.length > 0) {
    const { data: vRows } = await admin
      .from("products_variants")
      .select("id, product_id, variant_name, price, stock_quantity, stock, barcode, sku")
      .in("product_id", productIds)
    variants = (vRows || []) as RetailPosBootstrapPayload["variants"]
  }

  const variantIds = variants.map((v) => v.id)
  let variantStockMap: Record<string, number> = {}
  if (variantIds.length > 0) {
    const { data: vStockRows } = await admin
      .from("products_stock")
      .select("variant_id, stock, stock_quantity")
      .in("variant_id", variantIds)
      .eq("store_id", storeId)

    for (const row of vStockRows || []) {
      const r = row as { variant_id?: string | null; stock?: number | null; stock_quantity?: number | null }
      const vid = r.variant_id
      if (!vid) continue
      const sq = Math.floor(
        r.stock_quantity != null && r.stock_quantity !== undefined
          ? Number(r.stock_quantity)
          : r.stock != null && r.stock !== undefined
            ? Number(r.stock)
            : 0
      )
      variantStockMap[vid] = (variantStockMap[vid] || 0) + sq
    }
  }

  const stockMap: Record<string, number> = {}
  for (const row of stockRows) {
    if (row.variant_id) continue
    const pid = row.product_id
    const sq = Math.floor(
      row.stock_quantity != null && row.stock_quantity !== undefined
        ? Number(row.stock_quantity)
        : row.stock != null && row.stock !== undefined
          ? Number(row.stock)
          : 0
    )
    stockMap[pid] = (stockMap[pid] || 0) + sq
  }

  const hasAnyStockRecords = stockRows.length > 0

  const productsOut = allProducts
    .map((p) => {
      const id = String(p.id)
      const stockQty = stockMap[id] !== undefined ? stockMap[id] : 0
      const hasVariants = productsWithVariantIds.has(id)
      return {
        ...p,
        price: Number(p.price || 0),
        stock: stockQty,
        stock_quantity: stockQty,
        low_stock_threshold: p.low_stock_threshold != null ? Number(p.low_stock_threshold) : 5,
        track_stock: p.track_stock !== undefined ? p.track_stock : true,
        barcode: p.barcode || undefined,
        category_id: p.category_id || undefined,
        image_url: p.image_url || undefined,
        hasVariants,
        tax_category: p.tax_category ?? undefined,
      }
    })
    .filter((p: Record<string, unknown>) => {
      if (p.track_stock === false) return true
      if (!hasAnyStockRecords) return true
      if (p.hasVariants) return true
      return (Number(p.stock) || 0) > 0
    })

  const { data: catRows, error: catErr } = await admin
    .from("categories")
    .select("id, name, vat_type")
    .eq("business_id", businessId)

  const categories =
    !catErr && catRows
      ? (catRows as Array<{ id: string; name: string; vat_type?: string | null }>)
      : []

  let quickKeyProducts: Array<Record<string, unknown>> = []
  const { data: qkRows } = await admin
    .from("quick_keys")
    .select(`order_index, display_name, products (${productSelect})`)
    .eq("business_id", businessId)
    .order("order_index", { ascending: true })
    .limit(6)

  if (qkRows && qkRows.length > 0) {
    for (const row of qkRows as Array<{ products?: unknown; display_name?: string | null }>) {
      const raw = row.products
      const prod = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null
      if (!prod || String(prod.business_id) !== businessId) continue
      if (String(prod.id) && Number(prod.price || 0) > 0) {
        quickKeyProducts.push({
          ...prod,
          price: Number(prod.price || 0),
          display_name_override: row.display_name,
        })
      }
    }
  }

  const openSessions = (sessions || []).map((session: any) => ({
    id: session.id,
    register_id: session.register_id,
    user_id: session.user_id,
    store_id: session.store_id,
    started_at: session.started_at,
    opening_float:
      session.opening_float !== null && session.opening_float !== undefined
        ? Number(session.opening_float)
        : undefined,
    registers: Array.isArray(session.registers)
      ? session.registers[0] || null
      : session.registers || null,
    stores: Array.isArray(session.stores) ? session.stores[0] || null : session.stores || null,
  }))

  const payload: RetailPosBootstrapPayload = {
    business: {
      id: b.id,
      name: displayName,
      address_country: b.address_country ?? null,
      default_currency: b.default_currency ?? null,
    },
    store: {
      id: String((storeRow as { id: string }).id),
      name: (storeRow as { name?: string | null }).name ?? null,
    },
    cashier: {
      id: cashierId,
      display_name: (userRow as { full_name?: string | null }).full_name?.trim() || null,
    },
    registers: (registers || []) as RetailPosBootstrapPayload["registers"],
    open_cashier_sessions: openSessions,
    products: productsOut,
    variant_stock_by_id: variantStockMap,
    variants,
    categories,
    quick_key_products: quickKeyProducts,
  }

  return { ok: true, payload }
}
