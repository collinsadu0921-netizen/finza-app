import { randomUUID } from "crypto"
import type { PricingMode, ProposalSectionBlock } from "@/lib/proposals/schema"
import { proposalSectionsSchema } from "@/lib/proposals/schema"
import { validateAndNormalizePricingForDb } from "@/lib/proposals/pricingForDb"
import type {
  ProposalAiChange,
  ProposalAiChapter,
  ProposalAiDraft,
  ProposalAiEdit,
  ProposalAiPricing,
} from "./schema"
import type { ProposalAiCustomerHint, ProposalAiPreview, ProposalAiSnapshot } from "./types"

const ACCEPTANCE_TITLE = /^(acceptance|sign[ -]?off|approval|client acceptance)$/i
const PRICING_TITLE = /^(investment|investments|fee schedule|pricing|pricing schedule|commercials?|investment and pricing)$/i

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function chapterKey(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase()
}

function blockId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 18)}`
}

function chapterBlocks(chapter: ProposalAiChapter): ProposalSectionBlock[] {
  const blocks: ProposalSectionBlock[] = []
  for (const text of chapter.paragraphs) {
    const trimmed = text.trim()
    if (trimmed) blocks.push({ type: "paragraph", text: trimmed, id: blockId("ai_p") })
  }
  const bullets = chapter.bullets.map((item) => item.trim()).filter(Boolean)
  if (bullets.length > 0) {
    blocks.push({ type: "bullet_list", items: bullets, id: blockId("ai_l") })
  }
  return blocks
}

export type ChapterRange = {
  start: number
  end: number
  title: string
  hidden: boolean
}

/** H2 heading plus every following block until the next H2. */
export function chapterRanges(sections: ProposalSectionBlock[]): ChapterRange[] {
  const ranges: ChapterRange[] = []
  let i = 0
  while (i < sections.length) {
    const section = sections[i]
    if (section.type !== "heading" || section.level !== 2) {
      i += 1
      continue
    }
    let end = i + 1
    while (end < sections.length) {
      const next = sections[end]
      if (next.type === "heading" && next.level === 2) break
      end += 1
    }
    ranges.push({
      start: i,
      end,
      title: section.text.trim() || "Untitled chapter",
      hidden: section.hidden === true,
    })
    i = end
  }
  return ranges
}

export function findChapterRange(
  sections: ProposalSectionBlock[],
  title: string
): ChapterRange | null {
  const key = chapterKey(title)
  return chapterRanges(sections).find((range) => chapterKey(range.title) === key) ?? null
}

export function chapterTitles(sections: ProposalSectionBlock[]): string[] {
  return chapterRanges(sections).map((range) => range.title)
}

function pricingToPayload(pricing: ProposalAiPricing): {
  pricing_mode: PricingMode
  pricing_payload: unknown
} {
  if (pricing.mode === "none") {
    return { pricing_mode: "none", pricing_payload: {} }
  }
  if (pricing.mode === "fixed") {
    const amount = roundMoney(Number(pricing.fixed_amount ?? 0))
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("The AI returned a fixed price without a positive amount.")
    }
    return {
      pricing_mode: "fixed",
      pricing_payload: {
        amount,
        ...(pricing.fixed_label?.trim() ? { label: pricing.fixed_label.trim() } : {}),
      },
    }
  }

  const items = pricing.items
    .map((item) => {
      const description = item.description.trim()
      const quantity = Number(item.quantity)
      const unit_price = roundMoney(Number(item.unit_price))
      const discount_amount = roundMoney(Number(item.discount_amount ?? 0))
      if (!description) return null
      if (!Number.isFinite(quantity) || quantity <= 0) return null
      if (!Number.isFinite(unit_price) || unit_price < 0) return null
      if (!Number.isFinite(discount_amount) || discount_amount < 0) return null
      if (discount_amount > quantity * unit_price) return null
      return {
        description,
        quantity,
        unit_price,
        ...(discount_amount > 0 ? { discount_amount } : {}),
        line_total: roundMoney(quantity * unit_price - discount_amount),
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  if (items.length === 0) {
    throw new Error("The AI returned pricing without usable line items.")
  }
  return { pricing_mode: "line_items", pricing_payload: { items } }
}

function normalizeSnapshotPricing(snapshot: ProposalAiSnapshot): {
  pricing_mode: PricingMode
  pricing_payload: unknown
} {
  const normalized = validateAndNormalizePricingForDb(snapshot.pricing_mode, snapshot.pricing_payload)
  return { pricing_mode: normalized.pricing_mode, pricing_payload: normalized.pricing_payload }
}

function validateNoDuplicateChapterTitles(sections: ProposalSectionBlock[]): void {
  const seen = new Set<string>()
  for (const range of chapterRanges(sections)) {
    const key = chapterKey(range.title)
    if (seen.has(key)) {
      throw new Error(`The document would contain two chapters titled "${range.title}".`)
    }
    seen.add(key)
  }
}

function replaceChapter(
  sections: ProposalSectionBlock[],
  range: ChapterRange,
  chapter: ProposalAiChapter
): ProposalSectionBlock[] {
  const replacement: ProposalSectionBlock[] = [
    {
      type: "heading",
      level: 2,
      text: chapter.title.trim(),
      id: blockId("ai_h"),
      ...(range.hidden ? { hidden: true } : {}),
    },
    ...chapterBlocks(chapter),
  ]
  return [...sections.slice(0, range.start), ...replacement, ...sections.slice(range.end)]
}

function insertChapter(
  sections: ProposalSectionBlock[],
  chapter: ProposalAiChapter,
  afterChapter: string | null
): ProposalSectionBlock[] {
  const newBlocks: ProposalSectionBlock[] = [
    { type: "heading", level: 2, text: chapter.title.trim(), id: blockId("ai_h") },
    ...chapterBlocks(chapter),
  ]
  const ranges = chapterRanges(sections)
  if (afterChapter) {
    const after = ranges.find((range) => chapterKey(range.title) === chapterKey(afterChapter))
    if (!after) {
      throw new Error(`Cannot add the chapter after "${afterChapter}" because it was not found.`)
    }
    return [...sections.slice(0, after.end), ...newBlocks, ...sections.slice(after.end)]
  }
  const acceptance = ranges.find((range) => ACCEPTANCE_TITLE.test(range.title))
  const insertAt = acceptance ? acceptance.start : sections.length
  return [...sections.slice(0, insertAt), ...newBlocks, ...sections.slice(insertAt)]
}

export type ApplyAiChangesResult =
  | {
      ok: true
      preview: ProposalAiPreview
    }
  | {
      ok: false
      error: string
    }

/**
 * Applies structured AI operations deterministically. AI never supplies block
 * IDs, image IDs, or arithmetic totals; only the targeted fields change.
 */
export function applyProposalAiChanges(
  snapshot: ProposalAiSnapshot,
  edit: ProposalAiEdit
): ApplyAiChangesResult {
  try {
    let title = snapshot.title
    let sections = proposalSectionsSchema.parse(snapshot.sections)
    let pricing = normalizeSnapshotPricing(snapshot)
    const changed = new Set<string>()
    const warnings: string[] = []

    for (const change of edit.changes as ProposalAiChange[]) {
      switch (change.op) {
        case "set_title": {
          const next = change.title?.trim()
          if (!next) throw new Error("The AI did not provide a proposal title.")
          title = next
          changed.add("Proposal title")
          break
        }
        case "update_pricing": {
          if (!change.pricing) throw new Error("The AI did not provide updated pricing.")
          pricing = pricingToPayload(change.pricing)
          changed.add("Pricing")
          break
        }
        case "replace_chapter": {
          const chapterTitle = change.chapter_title?.trim()
          if (!chapterTitle || !change.chapter) {
            throw new Error("The AI did not identify a chapter to replace.")
          }
          const range = findChapterRange(sections, chapterTitle)
          if (!range) {
            throw new Error(
              `Chapter "${chapterTitle}" was not found. Available chapters: ${chapterTitles(sections).join(", ")}.`
            )
          }
          if (chapterBlocks(change.chapter).length === 0) {
            throw new Error(`Chapter "${chapterTitle}" would be left empty.`)
          }
          if (sections.slice(range.start, range.end).some((block) => block.type === "rich_text")) {
            warnings.push(
              `Chapter "${chapterTitle}" contains manual formatting. Replacing it with AI text will reset formatting in that chapter; unaffected chapters are preserved.`
            )
          }
          sections = replaceChapter(sections, range, change.chapter)
          changed.add(change.chapter.title.trim())
          break
        }
        case "add_chapter": {
          if (!change.chapter) throw new Error("The AI did not provide a chapter to add.")
          const newTitle = change.chapter.title.trim()
          if (!newTitle) throw new Error("The AI did not provide a chapter title.")
          if (findChapterRange(sections, newTitle)) {
            throw new Error(`A chapter titled "${newTitle}" already exists.`)
          }
          if (chapterBlocks(change.chapter).length === 0) {
            throw new Error(`Chapter "${newTitle}" would be empty.`)
          }
          sections = insertChapter(sections, change.chapter, change.after_chapter)
          changed.add(newTitle)
          break
        }
        case "remove_chapter": {
          const chapterTitle = change.chapter_title?.trim()
          if (!chapterTitle) throw new Error("The AI did not identify a chapter to remove.")
          const range = findChapterRange(sections, chapterTitle)
          if (!range) {
            throw new Error(`Chapter "${chapterTitle}" was not found.`)
          }
          if (ACCEPTANCE_TITLE.test(range.title)) {
            throw new Error("The Acceptance chapter cannot be removed.")
          }
          if (sections.slice(range.start, range.end).some((block) => block.type === "rich_text")) {
            warnings.push(
              `Chapter "${chapterTitle}" contains manual formatting and will be removed entirely.`
            )
          }
          sections = [...sections.slice(0, range.start), ...sections.slice(range.end)]
          changed.add(chapterTitle)
          break
        }
        default:
          throw new Error("Unsupported AI change.")
      }
    }

    validateNoDuplicateChapterTitles(sections)
    const finalPricing = validateAndNormalizePricingForDb(pricing.pricing_mode, pricing.pricing_payload)

    return {
      ok: true,
      preview: {
        title,
        customer_id: snapshot.customer_id,
        customer_hint: null,
        sections,
        pricing_mode: finalPricing.pricing_mode,
        pricing_payload: finalPricing.pricing_payload,
        changed_chapters: [...changed],
        warnings,
      },
    }
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The AI changes could not be applied.",
    }
  }
}

export type ApplyDraftResult =
  | {
      ok: true
      preview: ProposalAiPreview
    }
  | {
      ok: false
      error: string
    }

/**
 * Maps a structured AI draft into Finza section blocks and a validated pricing
 * payload. Generated chapters are ordinary editable chapters; no separate
 * document format is created.
 */
export function applyProposalAiDraft(args: {
  draft: ProposalAiDraft
  customerIds: Set<string>
  customerNames: Map<string, string>
}): ApplyDraftResult {
  try {
    const { draft } = args
    const title = draft.title.trim()
    if (!title) throw new Error("The AI returned an empty proposal title.")

    const seen = new Set<string>()
    const sections: ProposalSectionBlock[] = [
      { type: "heading", level: 1, text: title, id: blockId("ai_title") },
    ]

    for (const chapter of draft.chapters) {
      const chapterTitle = chapter.title.trim()
      if (!chapterTitle) throw new Error("The AI returned a chapter without a title.")
      const key = chapterKey(chapterTitle)
      if (seen.has(key)) throw new Error(`The AI returned two chapters titled "${chapterTitle}".`)
      seen.add(key)
      const blocks = chapterBlocks(chapter)
      if (blocks.length === 0) continue
      sections.push(
        { type: "heading", level: 2, text: chapterTitle, id: blockId("ai_h") },
        ...blocks
      )
    }

    if (chapterRanges(sections).length === 0) {
      throw new Error("The AI draft did not contain any usable chapters.")
    }

    const hasPricingChapter = chapterRanges(sections).some((range) => PRICING_TITLE.test(range.title))
    if (!hasPricingChapter && draft.pricing.mode !== "none") {
      const acceptance = findChapterRange(sections, "Acceptance")
      const insertAt = acceptance ? acceptance.start : sections.length
      sections.splice(
        insertAt,
        0,
        { type: "heading", level: 2, text: "Investment and pricing", id: blockId("ai_h") },
        {
          type: "paragraph",
          text: "The investment for the proposed work is summarised below.",
          id: blockId("ai_p"),
        }
      )
    }

    if (!findChapterRange(sections, "Acceptance")) {
      sections.push(
        { type: "heading", level: 2, text: "Acceptance", id: blockId("ai_h") },
        {
          type: "paragraph",
          text: "Review this proposal and use the online acceptance action to record your decision. This is not a qualified electronic signature.",
          id: blockId("ai_p"),
        }
      )
    }

    const pricing = pricingToPayload(draft.pricing)
    const finalPricing = validateAndNormalizePricingForDb(pricing.pricing_mode, pricing.pricing_payload)

    const warnings: string[] = []
    let customerId: string | null = null
    let customerHint: ProposalAiCustomerHint | null = null
    const match = draft.customer_match
    if (match.customer_id && args.customerIds.has(match.customer_id) && match.confidence !== "low") {
      customerId = match.customer_id
      customerHint = match
    } else if (match.customer_id || match.customer_name) {
      customerHint = {
        customer_id: null,
        customer_name: args.customerNames.get(match.customer_id ?? "") || match.customer_name?.trim() || null,
        confidence: match.confidence,
      }
      warnings.push(
        "No existing customer was applied automatically. Select or confirm the customer in the editor."
      )
    }

    validateNoDuplicateChapterTitles(sections)

    return {
      ok: true,
      preview: {
        title,
        customer_id: customerId,
        customer_hint: customerHint,
        sections,
        pricing_mode: finalPricing.pricing_mode,
        pricing_payload: finalPricing.pricing_payload,
        changed_chapters: chapterRanges(sections).map((range) => range.title),
        warnings,
      },
    }
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The AI draft could not be applied.",
    }
  }
}
