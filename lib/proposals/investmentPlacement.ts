import type { ProposalRenderSection } from "./renderModel"

/** Match pricing-section anchor (H1–H2 only; legacy "Investment" + current "Fee Schedule"). */
const PRICING_SECTION_HEADING = /^(investment|fee schedule)$/i

function isInvestmentAnchor(s: ProposalRenderSection): s is Extract<ProposalRenderSection, { type: "heading" }> {
  return s.type === "heading" && s.level <= 2 && PRICING_SECTION_HEADING.test(s.text.trim())
}

/**
 * Splits sections so the pricing anchor heading (H1–H2; "Fee Schedule" or legacy "Investment") and following blocks
 * can be grouped for the pricing shell. Editor preview, public page, and PDF use the same single-column body.
 * If there is no suitable heading, everything is `lead` and `investment` / `tail` are empty.
 */
export function splitForInvestmentPlacement(sections: ProposalRenderSection[]): {
  lead: ProposalRenderSection[]
  investment: ProposalRenderSection[]
  tail: ProposalRenderSection[]
} {
  const idx = sections.findIndex(isInvestmentAnchor)
  if (idx === -1) {
    return { lead: sections, investment: [], tail: [] }
  }
  const anchor = sections[idx] as Extract<ProposalRenderSection, { type: "heading" }>
  const anchorLevel = anchor.level
  const investment: ProposalRenderSection[] = [anchor]
  let j = idx + 1
  for (; j < sections.length; j++) {
    const s = sections[j]
    if (s.type === "heading" && s.level <= anchorLevel) break
    investment.push(s)
  }
  return {
    lead: sections.slice(0, idx),
    investment,
    tail: sections.slice(j),
  }
}
