import type { ProposalRenderSection } from "./renderModel"
import { richTextDocToPlainText, type ProposalRichTextDoc } from "./richText"

/** Exact placeholder copy shipped by Finza's starter templates. */
const GUIDANCE_TEXTS = new Set(
  [
    "A clear proposal for the work ahead. Replace the guidance below with the client's context, your approach, and the investment.",
    "Use this section to thank the client and summarise the opportunity.",
    "Introduce your business, relevant experience and the team.",
    "Summarise the client's goals, context and measures of success.",
    "Describe your recommended approach and why it fits the client's needs.",
    "Define what is included and explicitly note what is excluded.",
    "Add a scope item",
    "Add a deliverable",
    "Add an assumption or exclusion",
    "Add the acceptance criteria",
    "Add the phases, dates and owners agreed with the client.",
    "Optional: add project images or relevant examples. Do not add work you cannot evidence.",
    "Explain what the investment covers, the assumptions behind it, and what is billed separately.",
    "Add payment terms, validity, assumptions and any conditions that apply.",
    "Use the online acceptance action to record the client's decision. This is not a qualified electronic signature.",
    "Summarize what is in and out of scope. Use the bullet list below for key deliverables or phases.",
    "Figures are in the pricing panel on the right; this block is for narrative — scope covered, assumptions, and what is included in the fee.",
  ].map(normalize)
)

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

/** Known starter guidance phrases that must not reach a client document. */
export function isGuidanceText(value: string | null | undefined): boolean {
  if (!value) return false
  const text = normalize(value)
  if (!text) return false
  if (GUIDANCE_TEXTS.has(text)) return true
  return /^(use this section to|introduce your business|summari[sz]e the client's goals|describe your recommended approach|define what is included|add a scope item|add a deliverable|add an assumption|add the acceptance criteria|add the phases|replace the guidance|add payment terms)/.test(
    text
  )
}

function isGuidanceBlock(block: ProposalRenderSection): boolean {
  if (block.guidance === true) return true
  if (block.type === "heading" || block.type === "paragraph") return isGuidanceText(block.text)
  if (block.type === "rich_text") return isGuidanceText(richTextDocToPlainText(block.doc))
  if (block.type === "bullet_list") {
    return block.items.length > 0 && block.items.every((item) => isGuidanceText(item))
  }
  return false
}

/** Removes draft guidance from publishable chapters while preserving user content. */
export function stripGuidance(blocks: ProposalRenderSection[]): ProposalRenderSection[] {
  return blocks
    .filter((block) => !isGuidanceBlock(block))
    .map((block) => {
      if (block.type !== "bullet_list") return block
      const items = block.items.filter((item) => !isGuidanceText(item))
      return items.length === block.items.length ? block : { ...block, items }
    })
    .filter((block) => {
      if (block.type === "paragraph") return Boolean(block.text.trim())
      if (block.type === "bullet_list") return block.items.length > 0
      if (block.type === "heading") return Boolean(block.text.trim())
      if (block.type === "rich_text") return Boolean(richTextDocToPlainText(block.doc).trim())
      return true
    })
}

export type ProposalPublishValidation = {
  blocking: string[]
  warnings: string[]
}

type PublishableBlock = {
  type: string
  text?: string
  items?: string[]
  doc?: unknown
  hidden?: boolean
  guidance?: boolean
}

function isGuidanceBlockLike(block: PublishableBlock): boolean {
  if (block.hidden) return false
  if (block.guidance === true) return true
  if ((block.type === "heading" || block.type === "paragraph") && typeof block.text === "string") {
    return isGuidanceText(block.text)
  }
  if (block.type === "bullet_list" && Array.isArray(block.items)) {
    return block.items.length > 0 && block.items.every((item) => isGuidanceText(item))
  }
  if (block.type === "rich_text") {
    return isGuidanceText(richTextDocToPlainText(block.doc as ProposalRichTextDoc | null | undefined))
  }
  return false
}

/**
 * Schema-block variant used by API routes before sending. It avoids requiring
 * render-only image URLs and keeps the same guidance semantics.
 */
export function validateProposalSectionsForPublish(
  sections: PublishableBlock[],
  options?: { pricing_mode?: string | null; hasCustomer?: boolean }
): ProposalPublishValidation {
  const blocking: string[] = []
  const warnings: string[] = []
  const guidanceBlocks = sections.filter(isGuidanceBlockLike)
  if (guidanceBlocks.length > 0) {
    blocking.push(
      `${guidanceBlocks.length} starter guidance block${guidanceBlocks.length === 1 ? "" : "s"} still need editing before this proposal can be sent.`
    )
  }

  const visible = sections.filter((section) => !section.hidden)
  const meaningful = visible.filter((section) => {
    if (section.type === "heading" || section.type === "divider") return false
    if (section.type === "paragraph") return Boolean(section.text?.trim())
    if (section.type === "rich_text") return Boolean(richTextDocToPlainText(section.doc as ProposalRichTextDoc | null | undefined).trim())
    if (section.type === "bullet_list") {
      return (section.items ?? []).some((item) => item.trim() && !isGuidanceText(item))
    }
    return true
  })
  if (meaningful.length === 0) {
    blocking.push("The proposal has no publishable content after draft guidance is removed.")
  }

  const pricingMode = (options?.pricing_mode || "none").trim().toLowerCase()
  if ((pricingMode === "fixed" || pricingMode === "line_items") && !sections.some((section) => section.type === "paragraph")) {
    warnings.push("Check the investment chapter before sending.")
  }
  if (options?.hasCustomer === false) {
    warnings.push("No customer is selected. The client-facing cover will not show a recipient.")
  }
  return { blocking, warnings }
}

/** Server-side readiness check used before sending or publishing. */
export function validateProposalForPublish(
  sections: ProposalRenderSection[],
  options?: { pricing_mode?: string | null; hasCustomer?: boolean }
): ProposalPublishValidation {
  const blocking: string[] = []
  const warnings: string[] = []
  const guidanceBlocks = sections.filter((section) => !section.hidden && isGuidanceBlock(section))

  if (guidanceBlocks.length > 0) {
    blocking.push(
      `${guidanceBlocks.length} starter guidance block${guidanceBlocks.length === 1 ? "" : "s"} still need editing before this proposal can be sent.`
    )
  }

  const visibleContent = stripGuidance(sections.filter((section) => !section.hidden))
  const meaningful = visibleContent.filter(
    (section) =>
      section.type !== "heading" &&
      section.type !== "divider" &&
      !(section.type === "paragraph" && !section.text.trim()) &&
      !(section.type === "bullet_list" && section.items.length === 0)
  )
  if (meaningful.length === 0) {
    blocking.push("The proposal has no publishable content after draft guidance is removed.")
  }

  const pricingMode = (options?.pricing_mode || "none").trim().toLowerCase()
  if ((pricingMode === "fixed" || pricingMode === "line_items") && !sections.some((section) => section.type === "paragraph")) {
    warnings.push("Check the investment chapter before sending.")
  }
  if (options?.hasCustomer === false) {
    warnings.push("No customer is selected. The client-facing cover will not show a recipient.")
  }

  return { blocking, warnings }
}
