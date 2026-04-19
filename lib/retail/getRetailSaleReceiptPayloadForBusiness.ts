import type { SupabaseClient } from "@supabase/supabase-js"
import type { RetailReceiptApiBody } from "@/app/retail/lib/mapRetailReceiptApiToEscpos"

export type RetailSaleReceiptPayloadResult =
  | {
      ok: true
      body: RetailReceiptApiBody
      default_currency: string | null
      receipt_settings: Record<string, unknown> | null
    }
  | { ok: false; status: number; error: string }

type Options = {
  /** When set, sale must belong to this store (retail POS cashier binding). */
  expectedStoreId?: string | null
}

/**
 * Load receipt JSON for a sale (or parked row by id) scoped to a business.
 * Uses an admin/service Supabase client — caller must enforce auth.
 */
export async function getRetailSaleReceiptPayloadForBusiness(
  supabase: SupabaseClient,
  saleId: string,
  businessId: string,
  options?: Options
): Promise<RetailSaleReceiptPayloadResult> {
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("name, legal_name, trading_name, default_currency, logo_url")
    .eq("id", businessId)
    .single()

  if (businessError || !business) {
    return { ok: false, status: 404, error: "Business not found" }
  }

  const default_currency =
    typeof (business as { default_currency?: string | null }).default_currency === "string"
      ? (business as { default_currency: string }).default_currency.trim() || null
      : null

  const { data: rs } = await supabase
    .from("receipt_settings")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle()

  const receipt_settings = rs && typeof rs === "object" ? (rs as Record<string, unknown>) : null

  const businessPayload = {
    name: business.name as string,
    legal_name: (business as { legal_name?: string | null }).legal_name ?? null,
    trading_name: (business as { trading_name?: string | null }).trading_name ?? null,
    logo_url: (business as { logo_url?: string | null }).logo_url ?? null,
  }

  const { data: parkedSale } = await supabase
    .from("parked_sales")
    .select("*")
    .eq("id", saleId)
    .maybeSingle()

  if (parkedSale) {
    if (parkedSale.business_id !== businessId) {
      return { ok: false, status: 404, error: "Sale not found" }
    }
    const body = {
      sale: {
        id: parkedSale.id,
        amount: Number(parkedSale.subtotal || 0) + Number(parkedSale.taxes || 0),
        payment_method: "parked",
        payment_status: "parked",
        created_at: parkedSale.created_at,
        user_id: (parkedSale as { user_id?: string | null }).user_id ?? undefined,
        is_voided: false,
      },
      sale_items: (parkedSale.cart_json as RetailReceiptApiBody["sale_items"]) || [],
      business: businessPayload,
      store: null,
      customer: null,
      is_parked: true,
    } as RetailReceiptApiBody
    return { ok: true, body, default_currency, receipt_settings }
  }

  const { data: saleData, error: saleError } = await supabase
    .from("sales")
    .select(
      `
        *,
        users:user_id (
          email,
          full_name
        ),
        registers:register_id (
          name
        ),
        stores:store_id (
          name,
          logo_url
        ),
        customers:customer_id (
          name,
          phone,
          email
        )
      `
    )
    .eq("id", saleId)
    .single()

  if (saleError || !saleData) {
    return { ok: false, status: 404, error: "Sale not found" }
  }

  if (saleData.business_id !== businessId) {
    return { ok: false, status: 404, error: "Sale not found" }
  }

  const expectedStoreId = options?.expectedStoreId
  if (expectedStoreId && saleData.store_id && saleData.store_id !== expectedStoreId) {
    return { ok: false, status: 403, error: "Sale not found" }
  }

  const { data: voidedOverride } = await supabase
    .from("overrides")
    .select("id")
    .eq("action_type", "void_sale")
    .eq("reference_id", saleId)
    .maybeSingle()

  const isVoided = !!voidedOverride

  const { data: itemsData, error: itemsError } = await supabase
    .from("sale_items")
    .select("*")
    .eq("sale_id", saleId)
    .order("created_at", { ascending: true })

  if (itemsError) {
    return {
      ok: false,
      status: 500,
      error: itemsError.message || "Failed to load sale items",
    }
  }

  const sale = {
    id: saleData.id,
    receipt_lookup_id: saleData.id,
    amount: Number(saleData.amount),
    payment_method: saleData.payment_method,
    payment_status: saleData.payment_status,
    payment_lines: saleData.payment_lines
      ? typeof saleData.payment_lines === "string"
        ? JSON.parse(saleData.payment_lines)
        : saleData.payment_lines
      : null,
    subtotal_before_discount:
      (saleData as { subtotal_before_discount?: number | null }).subtotal_before_discount != null
        ? Number((saleData as { subtotal_before_discount?: number | null }).subtotal_before_discount)
        : null,
    total_discount:
      (saleData as { total_discount?: number | null }).total_discount != null
        ? Number((saleData as { total_discount?: number | null }).total_discount)
        : null,
    cart_discount_amount:
      (saleData as { cart_discount_amount?: number | null }).cart_discount_amount != null
        ? Number((saleData as { cart_discount_amount?: number | null }).cart_discount_amount)
        : null,
    cash_amount: saleData.cash_amount ? Number(saleData.cash_amount) : null,
    momo_amount: saleData.momo_amount ? Number(saleData.momo_amount) : null,
    card_amount: saleData.card_amount ? Number(saleData.card_amount) : null,
    cash_received: saleData.cash_received != null ? Number(saleData.cash_received) : null,
    change_given: saleData.change_given != null ? Number(saleData.change_given) : null,
    foreign_currency: saleData.foreign_currency,
    foreign_amount: saleData.foreign_amount ? Number(saleData.foreign_amount) : null,
    exchange_rate: saleData.exchange_rate ? Number(saleData.exchange_rate) : null,
    converted_ghs_amount: saleData.converted_ghs_amount
      ? Number(saleData.converted_ghs_amount)
      : null,
    nhil: saleData.nhil ? Number(saleData.nhil) : 0,
    getfund: saleData.getfund ? Number(saleData.getfund) : 0,
    covid: 0,
    vat: saleData.vat ? Number(saleData.vat) : 0,
    created_at: saleData.created_at,
    description: saleData.description,
    momo_transaction_id:
      (saleData as { momo_transaction_id?: string | null }).momo_transaction_id ?? null,
    hubtel_transaction_id:
      (saleData as { hubtel_transaction_id?: string | null }).hubtel_transaction_id ?? null,
    user_id: saleData.user_id,
    register_id: saleData.register_id,
    tax_lines: saleData.tax_lines || null,
    total_tax: saleData.total_tax ? Number(saleData.total_tax) : null,
    cashier: (() => {
      const raw = saleData.users as
        | { email?: string | null; full_name?: string | null }
        | { email?: string | null; full_name?: string | null }[]
        | null
      const u = Array.isArray(raw) ? raw[0] : raw
      return u ? { email: u.email, full_name: u.full_name } : null
    })(),
    register: (() => {
      const raw = saleData.registers as
        | { name?: string | null }
        | { name?: string | null }[]
        | null
      const r = Array.isArray(raw) ? raw[0] : raw
      return r?.name ? { name: r.name } : null
    })(),
    is_voided: isVoided,
  }

  const rawStore = saleData.stores as
    | { name?: string | null; logo_url?: string | null }
    | { name?: string | null; logo_url?: string | null }[]
    | null
  const storeRow = Array.isArray(rawStore) ? rawStore[0] : rawStore
  const storePayload =
    storeRow && (storeRow.name || storeRow.logo_url)
      ? {
          name: storeRow.name != null ? String(storeRow.name) : null,
          logo_url: storeRow.logo_url ?? null,
        }
      : null

  const rawCust = saleData.customers as
    | {
        name?: string | null
        phone?: string | null
        email?: string | null
      }
    | {
        name?: string | null
        phone?: string | null
        email?: string | null
      }[]
    | null
  const custRow = Array.isArray(rawCust) ? rawCust[0] : rawCust
  const customerPayload =
    custRow && (custRow.name || custRow.phone || custRow.email)
      ? {
          name: custRow.name ?? null,
          phone: custRow.phone ?? null,
          email: custRow.email ?? null,
        }
      : null

  const sale_items = (itemsData || []).map((item) => {
    const qty = Number(item.quantity || item.qty || 1)
    const unit = Number(item.unit_price || item.price || 0)
    const disc = Number((item as { discount_amount?: number | null }).discount_amount ?? 0)
    const gross = qty * unit
    const lineNet =
      (item as { line_total?: number | null }).line_total != null
        ? Number((item as { line_total?: number | null }).line_total)
        : gross - (Number.isFinite(disc) ? disc : 0)
    return {
      id: item.id,
      product_id: item.product_id,
      product_name: item.product_name || item.name || "Unknown",
      quantity: qty,
      unit_price: unit,
      line_total: lineNet,
      discount_amount: Number.isFinite(disc) && disc > 0 ? disc : 0,
      note: item.note || null,
    }
  })

    const body = {
      sale,
      sale_items,
      business: businessPayload,
      store: storePayload,
      customer: customerPayload,
      is_parked: false,
    } as RetailReceiptApiBody

    return { ok: true, body, default_currency, receipt_settings }
}
