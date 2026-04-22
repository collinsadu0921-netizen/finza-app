import {
  parsePricingFromRow,
  type PricingMode,
  type PricingPayload,
  pricingPayloadSchema,
} from "./schema"

/** Validate combined mode + payload; returns payload shape stored in JSONB (without redundant top-level mode when possible). */
export function validateAndNormalizePricingForDb(
  pricing_mode: PricingMode,
  pricing_payload: unknown
): { pricing_mode: PricingMode; pricing_payload: Record<string, unknown> } {
  const raw = pricing_payload && typeof pricing_payload === "object" && !Array.isArray(pricing_payload) ? pricing_payload : {}
  const mergedForZod = { ...raw, mode: pricing_mode }
  const parsed = pricingPayloadSchema.parse(mergedForZod) as PricingPayload

  if (parsed.mode === "none") {
    return { pricing_mode: "none", pricing_payload: {} }
  }
  if (parsed.mode === "fixed") {
    return {
      pricing_mode: "fixed",
      pricing_payload: { amount: parsed.amount, ...(parsed.label ? { label: parsed.label } : {}) },
    }
  }
  if (parsed.mode === "line_items") {
    return { pricing_mode: "line_items", pricing_payload: { items: parsed.items } }
  }
  return {
    pricing_mode: "custom",
    pricing_payload: {
      ...(parsed.notes ? { notes: parsed.notes } : {}),
      ...(parsed.raw && typeof parsed.raw === "object" ? (parsed.raw as Record<string, unknown>) : {}),
    },
  }
}

export function pricingPayloadForRender(pricing_mode: string, pricing_payload: unknown): PricingPayload {
  return parsePricingFromRow(pricing_mode, pricing_payload)
}
