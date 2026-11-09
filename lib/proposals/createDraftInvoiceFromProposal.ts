import type { SupabaseClient } from "@supabase/supabase-js"
import type { NextRequest } from "next/server"
import { createAuditLog } from "@/lib/auditLog"
import { assertBusinessNotArchived } from "@/lib/archivedBusiness"
import { getCurrencySymbol } from "@/lib/currency"
import { assertCountryCurrency } from "@/lib/countryCurrency"
import { buildEstimateItemsFromProposal } from "@/lib/proposals/buildEstimateItemsFromProposal"
import { mapInvoiceItemsForInsert } from "@/lib/invoices/validateInvoiceLineMaterials"
import { normalizeCountry } from "@/lib/payments/eligibility"
import {
  deriveLegacyTaxColumnsFromTaxLines,
  getCanonicalTaxResultFromLineItems,
  getTaxEngineCode,
} from "@/lib/taxEngine/helpers"
import { toTaxLinesJsonb } from "@/lib/taxEngine/serialize"
import type { TaxEngineConfig } from "@/lib/taxEngine/types"
import {
  enrichGhanaTaxResultWithScheduleMetadata,
  fetchGhanaEvatLevyScheduleMetadataMap,
} from "@/lib/tax/ghanaTaxScheduleMetadata"

export type ProposalInvoiceSource = {
  id: string
  business_id: string
  customer_id: string | null
  title: string
  proposal_number: string | null
  status: string
  pricing_mode: string
  pricing_payload: unknown
  currency_code: string | null
  converted_estimate_id: string | null
  converted_invoice_id: string | null
}

export type CreateDraftInvoiceFromProposalResult =
  | {
      ok: true
      invoiceId: string
      invoice: Record<string, unknown>
    }
  | {
      ok: false
      status: number
      error: string
      converted_invoice_id?: string | null
    }

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function dateOnly(value: Date): string {
  return value.toISOString().split("T")[0]
}

/**
 * Creates a draft invoice from an accepted proposal using the same canonical
 * tax engine and invoice settings used by the existing invoice creation flow.
 * The invoice remains unnumbered and unissued until staff review.
 */
export async function createDraftInvoiceFromProposal(args: {
  supabase: SupabaseClient
  userId: string
  businessId: string
  proposal: ProposalInvoiceSource
  fxRate?: number | null
  request?: NextRequest | null
}): Promise<CreateDraftInvoiceFromProposalResult> {
  const { supabase, businessId, proposal } = args

  if (proposal.status !== "accepted") {
    return {
      ok: false,
      status: 400,
      error: "Only accepted proposals can be converted to an invoice.",
    }
  }
  if (proposal.converted_invoice_id) {
    return {
      ok: false,
      status: 409,
      error: "This proposal already has a linked invoice.",
      converted_invoice_id: proposal.converted_invoice_id,
    }
  }
  if (proposal.converted_estimate_id) {
    return {
      ok: false,
      status: 409,
      error: "This proposal is already linked to an estimate. Create the invoice from that estimate instead.",
    }
  }

  const itemsBuild = buildEstimateItemsFromProposal({
    title: proposal.title || "",
    pricing_mode: proposal.pricing_mode || "none",
    pricing_payload: proposal.pricing_payload,
  })
  if (!itemsBuild.ok) {
    return { ok: false, status: itemsBuild.status, error: itemsBuild.error }
  }

  const items = itemsBuild.items.map((item) => ({
    description: item.description || "",
    quantity: Number(item.quantity ?? item.qty ?? 0),
    unit_price: Number(item.unit_price ?? 0),
    discount_amount: Number(item.discount_amount ?? 0),
  }))
  for (const item of items) {
    if (
      !item.description.trim() ||
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0 ||
      !Number.isFinite(item.unit_price) ||
      item.unit_price < 0 ||
      !Number.isFinite(item.discount_amount) ||
      item.discount_amount < 0
    ) {
      return { ok: false, status: 400, error: "Proposal line items are invalid for invoicing." }
    }
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("address_country, default_currency")
    .eq("id", businessId)
    .single()

  if (!business?.address_country) {
    return {
      ok: false,
      status: 400,
      error: "Business country is required. Set it in Business Profile settings before invoicing.",
    }
  }
  const homeCurrency = String(business.default_currency ?? "").trim().toUpperCase()
  if (!homeCurrency) {
    return {
      ok: false,
      status: 400,
      error: "Business currency is required. Set it in Business Profile settings before invoicing.",
    }
  }

  try {
    await assertBusinessNotArchived(supabase, businessId)
  } catch (error: unknown) {
    return {
      ok: false,
      status: 403,
      error: error instanceof Error ? error.message : "Business is archived",
    }
  }

  const countryCode = normalizeCountry(String(business.address_country))
  if (!countryCode) {
    return { ok: false, status: 400, error: "Business country could not be resolved for tax calculation." }
  }
  try {
    assertCountryCurrency(countryCode, homeCurrency)
  } catch (error: unknown) {
    return {
      ok: false,
      status: 400,
      error: error instanceof Error ? error.message : "Currency does not match business country.",
    }
  }

  const invoiceCurrency = String(proposal.currency_code ?? "").trim().toUpperCase() || homeCurrency
  const isFx = invoiceCurrency !== homeCurrency
  const fxRate = args.fxRate != null ? Number(args.fxRate) : null
  if (isFx && (!Number.isFinite(fxRate) || (fxRate ?? 0) <= 0)) {
    return {
      ok: false,
      status: 400,
      error: `An exchange rate is required to invoice in ${invoiceCurrency}. Enter 1 ${invoiceCurrency} in ${homeCurrency}.`,
    }
  }
  const currencySymbol = getCurrencySymbol(invoiceCurrency)
  if (!currencySymbol) {
    return { ok: false, status: 400, error: "Invoice currency is invalid." }
  }

  const issueDate = dateOnly(new Date())
  const taxConfig: TaxEngineConfig = {
    jurisdiction: countryCode,
    effectiveDate: issueDate,
    taxInclusive: true,
  }
  let taxResult = getCanonicalTaxResultFromLineItems(items, taxConfig)
  if (countryCode === "GH") {
    const scheduleMap = await fetchGhanaEvatLevyScheduleMetadataMap(supabase, {
      effectiveDate: issueDate,
    })
    taxResult = enrichGhanaTaxResultWithScheduleMetadata(taxResult, scheduleMap)
  }
  const baseSubtotal = roundMoney(taxResult.base_amount)
  const invoiceTotal = roundMoney(taxResult.total_amount)
  const legacyTax = deriveLegacyTaxColumnsFromTaxLines(taxResult.lines)

  if (
    !Number.isFinite(baseSubtotal) ||
    baseSubtotal < 0 ||
    !Number.isFinite(invoiceTotal) ||
    invoiceTotal < 0
  ) {
    return { ok: false, status: 400, error: "Tax calculation failed for this proposal." }
  }

  const { data: invoiceSettings } = await supabase
    .from("invoice_settings")
    .select("due_days_default, default_payment_terms, default_footer_message")
    .eq("business_id", businessId)
    .maybeSingle()

  const dueDate =
    invoiceSettings?.due_days_default && Number(invoiceSettings.due_days_default) > 0
      ? dateOnly(new Date(Date.now() + Number(invoiceSettings.due_days_default) * 86_400_000))
      : null

  let publicToken: string
  try {
    const { data: tokenData } = await supabase.rpc("generate_public_token")
    publicToken = tokenData || Buffer.from(`${businessId}-${Date.now()}`).toString("base64url")
  } catch {
    publicToken = Buffer.from(`${businessId}-${Date.now()}`).toString("base64url")
  }

  const proposalRef = (proposal.proposal_number || "").trim() || proposal.id
  const noteLines = [
    `Created from accepted proposal ${proposalRef}`,
    proposal.title ? proposal.title : null,
  ].filter(Boolean) as string[]

  const invoiceData = {
    business_id: businessId,
    customer_id: proposal.customer_id,
    invoice_number: null,
    issue_date: issueDate,
    due_date: dueDate,
    payment_terms: invoiceSettings?.default_payment_terms || null,
    notes: noteLines.join("\n\n"),
    footer_message: invoiceSettings?.default_footer_message || null,
    currency_code: invoiceCurrency,
    currency_symbol: currencySymbol,
    fx_rate: isFx ? fxRate : null,
    home_currency_code: isFx ? homeCurrency : null,
    home_currency_total: isFx && fxRate ? roundMoney(invoiceTotal * fxRate) : null,
    subtotal: baseSubtotal,
    total_tax: roundMoney(taxResult.total_tax),
    total: invoiceTotal,
    apply_taxes: true,
    status: "draft",
    public_token: publicToken,
    tax_lines: toTaxLinesJsonb(taxResult),
    tax_engine_code: getTaxEngineCode(countryCode),
    tax_engine_effective_from: issueDate,
    tax_jurisdiction: countryCode,
    nhil: roundMoney(legacyTax.nhil),
    getfund: roundMoney(legacyTax.getfund),
    covid: roundMoney(legacyTax.covid),
    vat: roundMoney(legacyTax.vat),
    wht_receivable_applicable: false,
    wht_receivable_rate: null,
    wht_receivable_amount: 0,
    source_proposal_id: proposal.id,
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .insert(invoiceData)
    .select()
    .single()

  if (invoiceError || !invoice) {
    const duplicate = invoiceError?.code === "23505"
    return {
      ok: false,
      status: duplicate ? 409 : 500,
      error: duplicate
        ? "An invoice has already been created from this proposal."
        : invoiceError?.message || "Invoice could not be created.",
    }
  }

  const invoiceItems = mapInvoiceItemsForInsert(
    String(invoice.id),
    items.map((item) => ({ ...item, qty: item.quantity })),
    new Set<string>(),
    new Set<string>()
  )
  const { error: itemsError } = await supabase.from("invoice_items").insert(invoiceItems)
  if (itemsError) {
    await supabase.from("invoices").delete().eq("id", invoice.id)
    return { ok: false, status: 500, error: "Invoice items could not be created." }
  }

  const now = new Date().toISOString()
  const { data: linked, error: linkError } = await supabase
    .from("proposals")
    .update({
      status: "converted",
      converted_invoice_id: invoice.id,
      converted_invoice_at: now,
    })
    .eq("id", proposal.id)
    .eq("business_id", businessId)
    .eq("status", "accepted")
    .is("converted_invoice_id", null)
    .is("converted_estimate_id", null)
    .select("id")

  if (linkError || !linked || linked.length === 0) {
    await supabase.from("invoices").delete().eq("id", invoice.id)
    return {
      ok: false,
      status: 409,
      error:
        "The proposal changed while the invoice was being created. No invoice was kept. Refresh and try again.",
    }
  }

  try {
    await createAuditLog({
      businessId,
      userId: args.userId,
      actionType: "proposal.converted_to_invoice",
      entityType: "proposal",
      entityId: proposal.id,
      newValues: {
        proposal_id: proposal.id,
        invoice_id: invoice.id,
        proposal_number: proposal.proposal_number,
      },
      description: `Created draft invoice from accepted proposal ${proposalRef}`,
      request: args.request ?? null,
    })
  } catch {
    // The invoice and proposal link already succeeded; never roll them back
    // because audit logging failed.
    console.error("[proposals.convert-invoice] audit log failed", { proposalId: proposal.id })
  }

  return { ok: true, invoiceId: String(invoice.id), invoice: invoice as Record<string, unknown> }
}
