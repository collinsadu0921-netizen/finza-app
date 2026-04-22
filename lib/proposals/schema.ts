import { z } from "zod"

/** Structured section blocks stored on `proposals.sections` (JSONB). */
export const proposalSectionBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heading"),
    id: z.string().min(1).optional(),
    level: z.number().int().min(1).max(6),
    text: z.string(),
  }),
  z.object({
    type: z.literal("paragraph"),
    id: z.string().min(1).optional(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("bullet_list"),
    id: z.string().min(1).optional(),
    items: z.array(z.string()),
  }),
  z.object({
    type: z.literal("image"),
    id: z.string().min(1).optional(),
    asset_id: z.string().uuid(),
    caption: z.string().optional(),
  }),
  z.object({
    type: z.literal("gallery"),
    id: z.string().min(1).optional(),
    asset_ids: z.array(z.string().uuid()).min(1),
    caption: z.string().optional(),
  }),
  z.object({
    type: z.literal("divider"),
    id: z.string().min(1).optional(),
  }),
])

export type ProposalSectionBlock = z.infer<typeof proposalSectionBlockSchema>

export const proposalSectionsSchema = z.array(proposalSectionBlockSchema)

export const pricingModeSchema = z.enum(["none", "fixed", "line_items", "custom"])

export type PricingMode = z.infer<typeof pricingModeSchema>

const lineItemSchema = z.object({
  description: z.string(),
  quantity: z.number().nonnegative().optional(),
  unit_price: z.number().optional(),
  line_total: z.number().optional(),
  discount_amount: z.number().nonnegative().optional(),
})

export const pricingPayloadSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({
    mode: z.literal("fixed"),
    amount: z.number(),
    label: z.string().optional(),
  }),
  z.object({
    mode: z.literal("line_items"),
    items: z.array(lineItemSchema),
  }),
  z.object({
    mode: z.literal("custom"),
    notes: z.string().optional(),
    raw: z.record(z.unknown()).optional(),
  }),
])

export type PricingPayload = z.infer<typeof pricingPayloadSchema>

function parseOptionalNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** Normalize one line item from JSONB (snake/camel keys, numeric strings). */
function normalizeLineItemFromDb(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return { description: "" }
  const o = raw as Record<string, unknown>
  const pick = (snake: string, camel: string) => (o[snake] !== undefined ? o[snake] : o[camel])
  return {
    description: String(o.description ?? ""),
    quantity: parseOptionalNumber(pick("quantity", "quantity")),
    unit_price: parseOptionalNumber(pick("unit_price", "unitPrice")),
    line_total: parseOptionalNumber(pick("line_total", "lineTotal")),
    discount_amount: parseOptionalNumber(pick("discount_amount", "discountAmount")),
  }
}

/** Map DB `pricing_mode` + `pricing_payload` JSON to a single discriminated payload for validation. */
export function parsePricingFromRow(pricingMode: string, pricingPayload: unknown): PricingPayload {
  const raw =
    pricingPayload && typeof pricingPayload === "object" && !Array.isArray(pricingPayload)
      ? (pricingPayload as Record<string, unknown>)
      : {}
  const mode = pricingModeSchema.safeParse(pricingMode).success ? pricingMode : "none"
  if (mode === "none") {
    return pricingPayloadSchema.parse({ mode: "none" })
  }
  if (mode === "fixed") {
    return pricingPayloadSchema.parse({
      mode: "fixed",
      amount: Number(raw.amount ?? 0),
      label: typeof raw.label === "string" ? raw.label : undefined,
    })
  }
  if (mode === "line_items") {
    const rawItems = Array.isArray(raw.items) ? raw.items : []
    const items = rawItems.map(normalizeLineItemFromDb)
    return pricingPayloadSchema.parse({ mode: "line_items", items })
  }
  return pricingPayloadSchema.parse({
    mode: "custom",
    notes: typeof raw.notes === "string" ? raw.notes : undefined,
    raw,
  })
}

export function parseProposalSections(value: unknown): ProposalSectionBlock[] {
  const parsed = proposalSectionsSchema.safeParse(value)
  if (!parsed.success) {
    return []
  }
  return parsed.data ?? []
}

export function assertProposalSections(value: unknown): ProposalSectionBlock[] {
  return proposalSectionsSchema.parse(value)
}
