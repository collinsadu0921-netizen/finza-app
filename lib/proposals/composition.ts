import type { ProposalRenderAttachment, ProposalRenderModel, ProposalRenderSection } from "./renderModel"
import { getProposalTheme, type ProposalTheme } from "./design"
import { stripGuidance } from "./guidance"
import type { ProposalTemplateId } from "./templates"

export type ProposalChapterKind = "content" | "pricing" | "acceptance"

export type ProposalCover = {
  title: string
  proposalNumber: string | null
  businessName: string
  businessLegalName: string | null
  businessTradingName: string | null
  businessLogoUrl: string | null
  coverImageUrl: string | null
  customerName: string | null
  customerEmail: string | null
  preparedByName: string | null
  preparedByTitle: string | null
  preparedByEmail: string | null
  preparedByPhone: string | null
  createdAt: string | null
  expiresAt: string | null
  accent: string
}

export type ProposalChapter = {
  key: string
  number: number
  title: string
  eyebrow: string
  kind: ProposalChapterKind
  blocks: ProposalRenderSection[]
  attachments: ProposalRenderAttachment[]
}

export type ProposalBook = {
  templateId: ProposalTemplateId
  theme: ProposalTheme
  cover: ProposalCover
  chapters: ProposalChapter[]
}

const PRICING_TITLE = /^(investment|investments|fee schedule|pricing|pricing schedule|commercials?|investment and pricing)$/i
const ACCEPTANCE_TITLE = /^(acceptance|sign[ -]?off|approval|client acceptance)$/i
const TERMS_TITLE = /terms|conditions/i
const SUPPORTING_TITLE = /^(supporting documents|attachments|appendix)$/i

function chapterTitle(section: ProposalRenderSection): string {
  return section.type === "heading" ? section.text.trim() : ""
}

function isChapterHeading(section: ProposalRenderSection): boolean {
  return section.type === "heading" && section.level === 2
}

function isHidden(section: ProposalRenderSection): boolean {
  return section.hidden === true
}

function defaultAcceptanceBlocks(): ProposalRenderSection[] {
  return [
    {
      type: "paragraph",
      text: "Acceptance of this proposal confirms the scope, timeline and investment described in this document.",
    },
    {
      type: "paragraph",
      text: "Use the online acceptance action to record the client's decision. This is not a qualified electronic signature.",
    },
  ]
}

function chapterKind(title: string): ProposalChapterKind {
  if (PRICING_TITLE.test(title)) return "pricing"
  if (ACCEPTANCE_TITLE.test(title)) return "acceptance"
  return "content"
}

function makeChapter(
  index: number,
  title: string,
  blocks: ProposalRenderSection[],
  attachments: ProposalRenderAttachment[] = []
): ProposalChapter {
  const cleanTitle = title.trim() || `Chapter ${index + 1}`
  return {
    key: `chapter-${index + 1}`,
    number: index + 1,
    title: cleanTitle,
    eyebrow: `Chapter ${String(index + 1).padStart(2, "0")}`,
    kind: chapterKind(cleanTitle),
    blocks,
    attachments,
  }
}

/**
 * Derive the client-facing book from the validated proposal content.
 *
 * The derivation is intentionally deterministic and shared by the reader and
 * PDF builder. Existing `sections` JSON remains the source of truth; no new
 * proposal content is fabricated.
 */
export function composeProposalBook(model: ProposalRenderModel): ProposalBook {
  const theme = getProposalTheme(model.presentation.templateId, {
    accentColor: model.presentation.accentColor,
    typography: model.presentation.typography,
  })

  const sections = model.sections
  const chapters: ProposalChapter[] = []

  // Content before the first H2 becomes the Introduction chapter. H1 is the
  // document title already represented by the cover, so it is not repeated.
  let index = 0
  const introBlocks: ProposalRenderSection[] = []
  while (index < sections.length && !isChapterHeading(sections[index])) {
    const section = sections[index]
    if (!isHidden(section) && !(section.type === "heading" && section.level === 1)) {
      introBlocks.push(section)
    }
    index += 1
  }
  if (introBlocks.length > 0) {
    const publishableIntro = stripGuidance(introBlocks)
    if (publishableIntro.length > 0) chapters.push(makeChapter(0, "Introduction", publishableIntro))
  }

  let hiddenPricingAnchor = false

  while (index < sections.length) {
    const heading = sections[index]
    if (!isChapterHeading(heading)) {
      index += 1
      continue
    }

    const hiddenChapter = isHidden(heading)
    const title = chapterTitle(heading) || `Chapter ${chapters.length + 1}`
    const blocks: ProposalRenderSection[] = []
    index += 1
    while (index < sections.length && !isChapterHeading(sections[index])) {
      const section = sections[index]
      if (!hiddenChapter && !isHidden(section)) blocks.push(section)
      index += 1
    }

    if (hiddenChapter) {
      if (chapterKind(title) === "pricing") hiddenPricingAnchor = true
      continue
    }

    const kind = chapterKind(title)
    const publishableBlocks = stripGuidance(blocks)
    // Keep a chapter if it has publishable content, or if it is a pricing/acceptance anchor.
    if (publishableBlocks.length > 0 || kind !== "content") {
      chapters.push(makeChapter(chapters.length, title, publishableBlocks))
    }
  }

  // An introduction paragraph followed by an explicit "Introduction" H2 is a
  // common authoring pattern. Merge the two so the reader never shows two
  // chapters with the same title.
  if (
    chapters.length >= 2 &&
    chapters[0].title.toLowerCase() === "introduction" &&
    chapters[1].title.toLowerCase() === "introduction"
  ) {
    chapters[0].blocks.push(...chapters[1].blocks)
    chapters.splice(1, 1)
  }

  // If the proposal has no H2 chapters at all, preserve any visible content as
  // a single chapter rather than rendering an empty book.
  if (chapters.length === 0) {
    const visible = sections.filter(
      (section) => !isHidden(section) && !(section.type === "heading" && section.level === 1)
    )
    if (visible.length > 0) {
      chapters.push(makeChapter(0, "Proposal", visible))
    }
  }

  // Pricing is a first-class chapter, inserted before terms/acceptance when the
  // author has not already created an Investment/Pricing chapter.
  const pricingIndex = chapters.findIndex((chapter) => chapter.kind === "pricing")
  if (model.pricing.mode !== "none" && !hiddenPricingAnchor) {
    if (pricingIndex < 0) {
      const insertAt = chapters.findIndex(
        (chapter) => chapter.kind === "acceptance" || TERMS_TITLE.test(chapter.title)
      )
      const pricingChapter = makeChapter(
        insertAt >= 0 ? insertAt : chapters.length,
        "Investment and pricing",
        []
      )
      chapters.splice(insertAt >= 0 ? insertAt : chapters.length, 0, pricingChapter)
    }
  } else if (pricingIndex >= 0) {
    if (chapters[pricingIndex].blocks.length === 0) {
      chapters.splice(pricingIndex, 1)
    } else {
      chapters[pricingIndex].kind = "content"
    }
  }

  // Supporting documents belong before the acceptance decision.
  const supportingIndex = chapters.findIndex((chapter) => SUPPORTING_TITLE.test(chapter.title))
  if (model.attachments.length > 0) {
    if (supportingIndex >= 0) {
      chapters[supportingIndex].attachments = model.attachments
    } else {
      const acceptanceAt = chapters.findIndex((chapter) => chapter.kind === "acceptance")
      const insertAt = acceptanceAt >= 0 ? acceptanceAt : chapters.length
      const supporting = makeChapter(insertAt, "Supporting documents", [], model.attachments)
      chapters.splice(insertAt, 0, supporting)
    }
  }

  // Acceptance is always the final chapter. Existing authored acceptance
  // chapters are preserved; a standard acceptance page is added when absent.
  let acceptanceIndex = chapters.findIndex((chapter) => chapter.kind === "acceptance")
  if (acceptanceIndex < 0) {
    chapters.push(makeChapter(chapters.length, "Acceptance", defaultAcceptanceBlocks()))
    acceptanceIndex = chapters.length - 1
  } else if (chapters[acceptanceIndex].blocks.length === 0) {
    chapters[acceptanceIndex].blocks = defaultAcceptanceBlocks()
  }
  if (acceptanceIndex !== chapters.length - 1) {
    const [acceptance] = chapters.splice(acceptanceIndex, 1)
    chapters.push(acceptance)
  }

  // Stable numbering after all insertions/reordering.
  chapters.forEach((chapter, chapterIndex) => {
    chapter.number = chapterIndex + 1
    chapter.eyebrow = `Chapter ${String(chapterIndex + 1).padStart(2, "0")}`
    chapter.key = `chapter-${chapterIndex + 1}`
  })

  const businessName =
    model.business.trading_name || model.business.legal_name || model.business.name

  return {
    templateId: theme.id,
    theme,
    cover: {
      title: model.title || "Proposal",
      proposalNumber: model.proposal_number,
      businessName,
      businessLegalName: model.business.legal_name ?? null,
      businessTradingName: model.business.trading_name ?? null,
      businessLogoUrl: model.business.logo_url ?? null,
      coverImageUrl: model.presentation.coverImageUrl ?? null,
      customerName: model.customer?.name ?? null,
      customerEmail: model.customer?.email ?? null,
      preparedByName: model.sender?.name ?? null,
      preparedByTitle: model.sender?.title ?? null,
      preparedByEmail: model.sender?.email ?? null,
      preparedByPhone: model.sender?.phone ?? null,
      createdAt: model.created_at ?? null,
      expiresAt: model.expires_at ?? null,
      accent: theme.accent,
    },
    chapters,
  }
}

export function chapterPageIndex(chapterIndex: number): number {
  // Page 0 is the cover; chapters start at page 1.
  return chapterIndex + 1
}
