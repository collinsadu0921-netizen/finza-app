import { z } from "zod"
import { pricingModeSchema, proposalSectionsSchema } from "@/lib/proposals/schema"

export const PROPOSAL_AI_MAX_INSTRUCTION_CHARS = 4_000
export const PROPOSAL_AI_MAX_SNAPSHOT_SECTIONS = 160
export const PROPOSAL_AI_MAX_BODY_BYTES = 256 * 1024
export const PROPOSAL_AI_MAX_OUTPUT_TOKENS = 6_000
export const PROPOSAL_AI_TIMEOUT_MS = 60_000

export const proposalAiChapterSchema = z.object({
  title: z.string().min(1).max(160),
  paragraphs: z.array(z.string().min(1).max(6_000)).max(14),
  bullets: z.array(z.string().min(1).max(600)).max(50),
})

export type ProposalAiChapter = z.infer<typeof proposalAiChapterSchema>

export const proposalAiPricingLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().positive().max(1_000_000),
  unit_price: z.number().nonnegative().max(1_000_000_000),
  discount_amount: z.number().nonnegative().max(1_000_000_000).nullable(),
})

export const proposalAiPricingSchema = z.object({
  mode: z.enum(["none", "fixed", "line_items"]),
  fixed_amount: z.number().nonnegative().max(1_000_000_000).nullable(),
  fixed_label: z.string().max(200).nullable(),
  items: z.array(proposalAiPricingLineSchema).max(60),
})

export type ProposalAiPricing = z.infer<typeof proposalAiPricingSchema>

export const proposalAiCustomerMatchSchema = z.object({
  customer_id: z.string().max(80).nullable(),
  customer_name: z.string().max(300).nullable(),
  confidence: z.enum(["high", "medium", "low"]),
})

export const proposalAiDraftSchema = z.object({
  summary: z.string().min(1).max(1_500),
  title: z.string().min(1).max(500),
  customer_match: proposalAiCustomerMatchSchema,
  chapters: z.array(proposalAiChapterSchema).min(2).max(16),
  pricing: proposalAiPricingSchema,
})

export type ProposalAiDraft = z.infer<typeof proposalAiDraftSchema>

export const proposalAiChangeSchema = z.object({
  op: z.enum([
    "set_title",
    "replace_chapter",
    "add_chapter",
    "remove_chapter",
    "update_pricing",
  ]),
  title: z.string().max(500).nullable(),
  chapter_title: z.string().max(160).nullable(),
  chapter: proposalAiChapterSchema.nullable(),
  pricing: proposalAiPricingSchema.nullable(),
  after_chapter: z.string().max(160).nullable(),
})

export type ProposalAiChange = z.infer<typeof proposalAiChangeSchema>

export const proposalAiEditSchema = z.object({
  summary: z.string().min(1).max(1_500),
  changes: z.array(proposalAiChangeSchema).min(1).max(8),
})

export type ProposalAiEdit = z.infer<typeof proposalAiEditSchema>

export const proposalAiSnapshotSchema = z.object({
  title: z.string().max(500),
  customer_id: z.string().max(80).nullable(),
  template_id: z.string().max(80),
  currency_code: z.string().max(12).nullable(),
  sections: proposalSectionsSchema.max(PROPOSAL_AI_MAX_SNAPSHOT_SECTIONS),
  pricing_mode: pricingModeSchema,
  pricing_payload: z.unknown(),
})

export const proposalAiRequestSchema = z
  .object({
    business_id: z.string().uuid(),
    action: z.enum(["generate", "edit", "refine", "generate_section"]),
    instruction: z.string().trim().min(3).max(PROPOSAL_AI_MAX_INSTRUCTION_CHARS),
    snapshot: proposalAiSnapshotSchema.optional(),
    chapter_title: z.string().trim().max(160).optional(),
  })
  .strict()

export type ProposalAiRequest = z.infer<typeof proposalAiRequestSchema>
