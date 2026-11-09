import type { ProposalSectionBlock } from "./schema"
import { PROPOSAL_PRICING_SECTION_HEADING } from "./pricingSectionCopy"

/**
 * Proposal template registry.
 *
 * `standard_v1` is the original Finza proposal layout and is retained for
 * existing proposals. New proposals default to `premium_v1`.
 */
export const LEGACY_PROPOSAL_TEMPLATE_ID = "standard_v1" as const
export const DEFAULT_PROPOSAL_TEMPLATE_ID = "premium_v1" as const

export const PROPOSAL_TEMPLATE_IDS = [
  LEGACY_PROPOSAL_TEMPLATE_ID,
  "minimal_v1",
  "modern_v1",
  "premium_v1",
] as const

export type ProposalTemplateId = (typeof PROPOSAL_TEMPLATE_IDS)[number]

export type ProposalTemplateMeta = {
  id: ProposalTemplateId
  label: string
  shortLabel: string
  description: string
  legacy: boolean
  accent: string
}

export const PROPOSAL_TEMPLATE_META: ProposalTemplateMeta[] = [
  {
    id: "minimal_v1",
    label: "Minimal",
    shortLabel: "Minimal",
    description: "Quiet serif typography, generous white space and restrained rules.",
    legacy: false,
    accent: "#1f2937",
  },
  {
    id: "modern_v1",
    label: "Modern",
    shortLabel: "Modern",
    description: "Strong sans headings, a bold cover and confident accent blocks.",
    legacy: false,
    accent: "#0f766e",
  },
  {
    id: "premium_v1",
    label: "Premium",
    shortLabel: "Premium",
    description: "Editorial book cover, cream pages, chapter numerals and elegant serif type.",
    legacy: false,
    accent: "#a6773f",
  },
  {
    id: LEGACY_PROPOSAL_TEMPLATE_ID,
    label: "Classic (legacy)",
    shortLabel: "Classic",
    description: "The original Finza proposal layout, retained for existing proposals.",
    legacy: true,
    accent: "#0f172a",
  },
]

export function getProposalTemplateMeta(id: string): ProposalTemplateMeta {
  return (
    PROPOSAL_TEMPLATE_META.find((template) => template.id === id) ??
    PROPOSAL_TEMPLATE_META.find((template) => template.id === DEFAULT_PROPOSAL_TEMPLATE_ID)!
  )
}

export function isKnownTemplateId(id: string): id is ProposalTemplateId {
  return (PROPOSAL_TEMPLATE_IDS as readonly string[]).includes(id)
}

export function normalizeTemplateId(id: string | null | undefined): ProposalTemplateId {
  const trimmed = typeof id === "string" ? id.trim() : ""
  return isKnownTemplateId(trimmed) ? trimmed : DEFAULT_PROPOSAL_TEMPLATE_ID
}

const STARTER_CHAPTERS = [
  ["Introduction", "Use this section to thank the client and summarise the opportunity."],
  ["About the company", "Introduce your business, relevant experience and the team."],
  ["Client needs and project overview", "Summarise the client's goals, context and measures of success."],
  ["Proposed solution", "Describe your recommended approach and why it fits the client's needs."],
  ["Scope of work", "Define what is included and explicitly note what is excluded."],
] as const

function premiumStarterSections(): ProposalSectionBlock[] {
  return [
    { type: "heading", level: 1, text: "Proposal", id: "blk_title" },
    {
      type: "paragraph",
      id: "blk_intro",
      text: "A clear proposal for the work ahead. Replace the guidance below with the client's context, your approach, and the investment.",
      guidance: true,
    },
    ...STARTER_CHAPTERS.flatMap(([title, body], index): ProposalSectionBlock[] => [
      { type: "heading", level: 2, text: title, id: `blk_ch_${index}_h` },
      { type: "paragraph", text: body, id: `blk_ch_${index}_p`, guidance: true },
      ...(index === 4
        ? [
            {
              type: "bullet_list" as const,
              id: "blk_scope_list",
              items: ["Add a scope item", "Add a deliverable", "Add an assumption or exclusion"],
              guidance: true,
            },
          ]
        : []),
    ]),
    { type: "heading", level: 2, text: "Deliverables", id: "blk_deliverables_h" },
    {
      type: "bullet_list",
      id: "blk_deliverables_list",
      items: ["Add a deliverable", "Add the acceptance criteria"],
      guidance: true,
    },
    { type: "heading", level: 2, text: "Timeline and milestones", id: "blk_timeline_h" },
    {
      type: "paragraph",
      id: "blk_timeline_p",
      text: "Add the phases, dates and owners agreed with the client.",
      guidance: true,
    },
    { type: "heading", level: 2, text: "Portfolio", id: "blk_portfolio_h" },
    {
      type: "paragraph",
      id: "blk_portfolio_p",
      text: "Optional: add project images or relevant examples. Do not add work you cannot evidence.",
      guidance: true,
    },
    { type: "heading", level: 2, text: "Investment and pricing", id: "blk_inv_h" },
    {
      type: "paragraph",
      id: "blk_inv_p",
      text: "Explain what the investment covers, the assumptions behind it, and what is billed separately.",
      guidance: true,
    },
    { type: "heading", level: 2, text: "Terms and conditions", id: "blk_terms_h" },
    {
      type: "paragraph",
      id: "blk_terms_p",
      text: "Add payment terms, validity, assumptions and any conditions that apply.",
      guidance: true,
    },
    { type: "heading", level: 2, text: "Acceptance", id: "blk_accept_h" },
    {
      type: "paragraph",
      id: "blk_accept_p",
      text: "Use the online acceptance action to record the client's decision. This is not a qualified electronic signature.",
      guidance: true,
    },
  ]
}

export function defaultSectionsForTemplate(templateId: string): ProposalSectionBlock[] {
  if (templateId === LEGACY_PROPOSAL_TEMPLATE_ID) {
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
        guidance: true,
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
        guidance: true,
      },
    ]
  }

  return premiumStarterSections()
}
