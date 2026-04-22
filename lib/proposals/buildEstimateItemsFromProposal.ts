import type { DraftEstimateLineInput } from "@/lib/estimates/createDraftEstimateForBusiness"
import { pricingPayloadForRender } from "@/lib/proposals/pricingForDb"
import type { PricingMode } from "@/lib/proposals/schema"

export type BuildEstimateItemsResult =
  | { ok: true; items: DraftEstimateLineInput[] }
  | { ok: false; error: string; status: number }

/**
 * Maps proposal pricing into estimate line items (draft quote).
 * - `none` → cannot convert
 * - `fixed` → single line (qty 1, unit_price = amount) — "summary" style pricing
 * - `line_items` → one row per payload item
 * - `custom` → not auto-supported
 */
export function buildEstimateItemsFromProposal(input: {
  title: string
  pricing_mode: string
  pricing_payload: unknown
}): BuildEstimateItemsResult {
  const mode = (input.pricing_mode || "none") as PricingMode
  if (mode === "none") {
    return {
      ok: false,
      status: 400,
      error:
        "This proposal has no billable pricing (mode: none). Add a fixed amount or line items before converting to an estimate.",
    }
  }

  if (mode === "custom") {
    return {
      ok: false,
      status: 400,
      error:
        "Custom proposal pricing cannot be converted automatically. Use fixed amount or line items on the proposal, then try again.",
    }
  }

  const parsed = pricingPayloadForRender(mode, input.pricing_payload)

  if (parsed.mode === "fixed") {
    const amount = Number(parsed.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, status: 400, error: "Proposal fixed pricing amount is missing or invalid." }
    }
    const label = (parsed.label || input.title || "Proposal").trim() || "Proposal"
    return {
      ok: true,
      items: [
        {
          description: `${label} (from proposal)`,
          quantity: 1,
          unit_price: Math.round(amount * 100) / 100,
          discount_amount: 0,
        },
      ],
    }
  }

  if (parsed.mode === "line_items") {
    const out: DraftEstimateLineInput[] = []
    for (const row of parsed.items) {
      const desc = (row.description || "").trim()
      if (!desc) continue
      const qtyRaw = row.quantity != null && Number.isFinite(Number(row.quantity)) ? Number(row.quantity) : 1
      const qty = qtyRaw > 0 ? qtyRaw : 1
      let unit = row.unit_price != null ? Number(row.unit_price) : NaN
      if (!Number.isFinite(unit) || unit < 0) {
        if (row.line_total != null && Number.isFinite(Number(row.line_total)) && qty > 0) {
          unit = Number(row.line_total) / qty
        } else {
          unit = 0
        }
      }
      const discount = row.discount_amount != null ? Number(row.discount_amount) : 0
      out.push({
        description: desc,
        quantity: qty,
        unit_price: Math.round(unit * 100) / 100,
        discount_amount: Number.isFinite(discount) ? Math.round(discount * 100) / 100 : 0,
      })
    }
    if (out.length === 0) {
      return { ok: false, status: 400, error: "Proposal line items are empty or invalid." }
    }
    return { ok: true, items: out }
  }

  return { ok: false, status: 400, error: "Unsupported proposal pricing mode for conversion." }
}
