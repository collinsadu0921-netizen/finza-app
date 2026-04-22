import type { SupabaseClient } from "@supabase/supabase-js"
import type { NextRequest } from "next/server"
import { createAuditLog } from "@/lib/auditLog"
import { getTaxEngineCode, deriveLegacyTaxColumnsFromTaxLines, getCanonicalTaxResultFromLineItems } from "@/lib/taxEngine/helpers"
import { toTaxLinesJsonb } from "@/lib/taxEngine/serialize"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { getCurrencySymbol } from "@/lib/currency"
import { assertBusinessNotArchived } from "@/lib/archivedBusiness"
import { assertCountryCurrency } from "@/lib/countryCurrency"
import type { TaxEngineConfig } from "@/lib/taxEngine/types"
import { pickEstimateItemProductServiceId } from "@/lib/estimates/pickEstimateItemProductServiceId"

/** Line shape compatible with POST /api/estimates/create `items`. */
export type DraftEstimateLineInput = {
  description?: string
  qty?: number
  quantity?: number
  unit_price?: number
  price?: number
  discount_amount?: number
  product_service_id?: string | null
  product_id?: string | null
}

export type CreateDraftEstimateForBusinessInput = {
  customer_id: string | null
  issue_date: string
  expiry_date?: string | null
  notes?: string | null
  items: DraftEstimateLineInput[]
  apply_taxes?: boolean
  currency_code?: string | null
  fx_rate?: number | null
  estimate_number?: string | null
}

export type CreateDraftEstimateResult =
  | { ok: true; estimate: Record<string, unknown>; estimateId: string }
  | { ok: false; status: number; error: string; message?: string; details?: unknown }

/**
 * Canonical draft estimate creation (tax engine, FX, estimate_items) shared by
 * POST /api/estimates/create and proposal → estimate conversion.
 */
export async function createDraftEstimateForBusiness(opts: {
  supabase: SupabaseClient
  userId: string
  businessId: string
  input: CreateDraftEstimateForBusinessInput
  request?: NextRequest | null
  /** When false, skips `estimate.created` audit (caller logs a different event). Default true. */
  logEstimateCreatedAudit?: boolean
}): Promise<CreateDraftEstimateResult> {
  const { supabase, businessId, input } = opts
  const apply_taxes = input.apply_taxes !== false
  const { issue_date, expiry_date, notes, items, currency_code, fx_rate } = input

  if (!issue_date || !items || items.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Missing required fields: issue_date and items are required",
      message: "Invalid request",
    }
  }

  const QUOTE_PREFIX = "QUO-"
  let finalEstimateNumber = input.estimate_number ?? null
  if (!finalEstimateNumber) {
    const { data: lastQuote } = await supabase
      .from("estimates")
      .select("estimate_number")
      .eq("business_id", businessId)
      .like("estimate_number", `${QUOTE_PREFIX}%`)
      .is("deleted_at", null)
      .order("estimate_number", { ascending: false })
      .limit(1)
      .maybeSingle()
    const lastNum = lastQuote?.estimate_number
      ? parseInt(lastQuote.estimate_number.replace(QUOTE_PREFIX, ""), 10) || 0
      : 0
    finalEstimateNumber = `${QUOTE_PREFIX}${String(lastNum + 1).padStart(4, "0")}`
  }

  const { data: businessData } = await supabase
    .from("businesses")
    .select("address_country, default_currency")
    .eq("id", businessId)
    .single()

  if (!businessData?.address_country) {
    return {
      ok: false,
      status: 400,
      error: "Business country is required. Please set your business country in Business Profile settings.",
      message: "Country required for tax calculation",
    }
  }

  try {
    await assertBusinessNotArchived(supabase, businessId)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Business is archived"
    return { ok: false, status: 403, error: msg }
  }

  const homeCurrencyCode = businessData.default_currency || null
  if (!homeCurrencyCode) {
    return {
      ok: false,
      status: 400,
      error: "Business currency is required. Please set your default currency in Business Profile settings.",
      message: "Currency required for estimate creation",
    }
  }

  const countryCode = normalizeCountry(businessData.address_country)
  try {
    assertCountryCurrency(countryCode, homeCurrencyCode)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Currency-country mismatch"
    return { ok: false, status: 400, error: msg, message: msg }
  }

  const estimateCurrencyCode = currency_code || homeCurrencyCode
  const isFxEstimate = !!(
    estimateCurrencyCode &&
    homeCurrencyCode &&
    estimateCurrencyCode.toUpperCase() !== homeCurrencyCode.toUpperCase()
  )
  const parsedFxRate = fx_rate != null ? Number(fx_rate) : null
  if (isFxEstimate && (!parsedFxRate || parsedFxRate <= 0)) {
    return {
      ok: false,
      status: 400,
      error: `Exchange rate is required when quoting in ${estimateCurrencyCode}. Please provide the rate (e.g. 1 ${estimateCurrencyCode} = X ${homeCurrencyCode}).`,
      message: "FX rate required for foreign currency quote",
    }
  }
  const estimateCurrencySymbol = getCurrencySymbol(estimateCurrencyCode || "")

  const lineItems = items.map((item) => ({
    quantity: Number(item.qty ?? item.quantity) || 0,
    unit_price: Number(item.unit_price ?? item.price) || 0,
    discount_amount: Number(item.discount_amount) || 0,
  }))

  for (const item of lineItems) {
    if (
      isNaN(item.quantity) ||
      item.quantity < 0 ||
      isNaN(item.unit_price) ||
      item.unit_price < 0 ||
      isNaN(item.discount_amount) ||
      item.discount_amount < 0
    ) {
      return {
        ok: false,
        status: 400,
        error: "Invalid line items. Please check quantities and prices.",
        message: "Line item validation failed",
      }
    }
  }

  const effectiveDate = issue_date || new Date().toISOString().split("T")[0]
  const jurisdiction = countryCode
  if (!jurisdiction) {
    return {
      ok: false,
      status: 400,
      error: "Jurisdiction required",
      message: "Business country could not be resolved for tax calculation.",
    }
  }
  const taxEngineCode = getTaxEngineCode(jurisdiction)
  let taxResult: import("@/lib/taxEngine/types").TaxResult | null = null
  let baseSubtotal: number
  let estimateTotal: number
  let legacyTaxColumns: { nhil: number; getfund: number; covid: number; vat: number }

  if (apply_taxes) {
    const config: TaxEngineConfig = {
      jurisdiction,
      effectiveDate,
      taxInclusive: true,
    }
    taxResult = getCanonicalTaxResultFromLineItems(lineItems, config)
    baseSubtotal = Math.round(taxResult.base_amount * 100) / 100
    estimateTotal = Math.round(taxResult.total_amount * 100) / 100
    legacyTaxColumns = deriveLegacyTaxColumnsFromTaxLines(taxResult.lines)
  } else {
    const subtotal = lineItems.reduce((sum, item) => {
      const lineTotal = item.quantity * item.unit_price
      const discount = item.discount_amount || 0
      return sum + lineTotal - discount
    }, 0)
    baseSubtotal = Math.round(subtotal * 100) / 100
    estimateTotal = Math.round(subtotal * 100) / 100
    legacyTaxColumns = { nhil: 0, getfund: 0, covid: 0, vat: 0 }
  }

  if (isNaN(baseSubtotal) || baseSubtotal < 0 || isNaN(estimateTotal) || estimateTotal < 0) {
    return {
      ok: false,
      status: 400,
      error: "Invalid tax calculation. Please check line items and try again.",
      message: "Tax calculation error",
    }
  }

  for (const [, value] of Object.entries(legacyTaxColumns)) {
    if (isNaN(value) || value < 0) {
      return {
        ok: false,
        status: 400,
        error: "Invalid tax calculation. Please check tax settings and try again.",
        message: "Tax calculation error",
      }
    }
  }

  const { data: estimate, error: estimateError } = await supabase
    .from("estimates")
    .insert({
      business_id: businessId,
      customer_id: input.customer_id || null,
      estimate_number: finalEstimateNumber,
      issue_date,
      expiry_date: expiry_date || null,
      notes: notes || null,
      currency_code: estimateCurrencyCode || null,
      currency_symbol: estimateCurrencySymbol || null,
      fx_rate: isFxEstimate ? parsedFxRate : null,
      home_currency_code: isFxEstimate ? homeCurrencyCode : null,
      home_currency_total:
        isFxEstimate && parsedFxRate ? Math.round(estimateTotal * parsedFxRate * 100) / 100 : null,
      subtotal: baseSubtotal,
      total_tax_amount: taxResult ? Math.round(taxResult.total_tax * 100) / 100 : 0,
      total_amount: estimateTotal,
      subtotal_before_tax: baseSubtotal,
      nhil_amount: Math.round(legacyTaxColumns.nhil * 100) / 100,
      getfund_amount: Math.round(legacyTaxColumns.getfund * 100) / 100,
      covid_amount: Math.round(legacyTaxColumns.covid * 100) / 100,
      vat_amount: Math.round(legacyTaxColumns.vat * 100) / 100,
      tax: taxResult ? Math.round(taxResult.total_tax * 100) / 100 : 0,
      status: "draft",
      tax_lines: taxResult ? toTaxLinesJsonb(taxResult) : null,
      tax_engine_code: apply_taxes ? taxEngineCode : null,
      tax_engine_effective_from: apply_taxes ? effectiveDate : null,
      tax_jurisdiction: apply_taxes ? jurisdiction : null,
    })
    .select()
    .single()

  if (estimateError || !estimate) {
    return {
      ok: false,
      status: 500,
      error: estimateError?.message || "Failed to create estimate",
      message: "Database error",
      details: estimateError,
    }
  }

  const estimateItems = items.map((item) => {
    const qty = Number(item.qty ?? item.quantity) || 0
    const price = Number(item.unit_price ?? item.price) || 0
    const discount = Number(item.discount_amount) || 0
    const total = Math.round(Math.max(0, qty * price - discount) * 100) / 100
    const productServiceId = pickEstimateItemProductServiceId(item as Record<string, unknown>)

    const itemData: Record<string, unknown> = {
      estimate_id: estimate.id,
      description: item.description || "",
      quantity: qty,
      price,
      total,
      discount_amount: discount,
    }
    if (productServiceId) {
      itemData.product_service_id = productServiceId
    }
    return itemData
  })

  const { error: itemsError } = await supabase.from("estimate_items").insert(estimateItems).select()

  if (itemsError) {
    await supabase.from("estimates").delete().eq("id", estimate.id as string)
    return {
      ok: false,
      status: 500,
      error: itemsError.message || "Failed to create estimate items",
      message: "Items creation failed",
      details: itemsError,
    }
  }

  if (opts.logEstimateCreatedAudit !== false) {
    await createAuditLog({
      businessId: estimate.business_id as string,
      userId: opts.userId,
      actionType: "estimate.created",
      entityType: "estimates",
      entityId: estimate.id as string,
      newValues: { estimate_number: estimate.estimate_number, status: estimate.status },
      description: `Created quote ${(estimate.estimate_number as string) || estimate.id}`,
      request: opts.request ?? null,
    })
  }

  return { ok: true, estimate: estimate as Record<string, unknown>, estimateId: estimate.id as string }
}
