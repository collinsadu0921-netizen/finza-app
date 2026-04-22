import type { ProposalSectionBlock } from "./schema"
import { PROPOSAL_PRICING_SECTION_HEADING } from "./pricingSectionCopy"

export const DEFAULT_PROPOSAL_TEMPLATE_ID = "standard_v1" as const

/** Built-in templates (no DB table in v1). */
export const PROPOSAL_TEMPLATE_IDS = [DEFAULT_PROPOSAL_TEMPLATE_ID] as const

export type ProposalTemplateId = (typeof PROPOSAL_TEMPLATE_IDS)[number]

export function isKnownTemplateId(id: string): id is ProposalTemplateId {
  return (PROPOSAL_TEMPLATE_IDS as readonly string[]).includes(id)
}

export function defaultSectionsForTemplate(templateId: string): ProposalSectionBlock[] {
  if (templateId === DEFAULT_PROPOSAL_TEMPLATE_ID) {
    return [
      { type: "heading", level: 1, text: "Proposal", id: "blk_title" },
      {
        type: "paragraph",
        id: "blk_intro",
        text: "Thank you for the opportunity to work together. Below is a summary of scope, approach, and investment.",
      },
      { type: "heading", level: 2, text: "Scope", id: "blk_scope_h" },
      {
        type: "paragraph",
        id: "blk_scope_p",
        text: "Summarize what is in and out of scope. Use the bullet list below for key deliverables or phases.",
      },
      {
        type: "bullet_list",
        id: "blk_scope_list",
        items: ["Discovery and requirements confirmation", "Delivery of agreed outcomes", "Handover and follow-up"],
      },
      { type: "heading", level: 2, text: "Timeline", id: "blk_time_h" },
      { type: "paragraph", id: "blk_time_p", text: "Timeline will be agreed after kickoff." },
      { type: "divider", id: "blk_div_1" },
      { type: "heading", level: 2, text: PROPOSAL_PRICING_SECTION_HEADING, id: "blk_inv_h" },
      {
        type: "paragraph",
        id: "blk_inv_p",
        text: "Figures are in the pricing panel on the right; this block is for narrative — scope covered, assumptions, and what is included in the fee.",
      },
    ]
  }
  return defaultSectionsForTemplate(DEFAULT_PROPOSAL_TEMPLATE_ID)
}
