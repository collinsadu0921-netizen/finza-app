import type { ProposalChapter } from "./composition"
import type { ProposalRenderSection } from "./renderModel"
import type { PricingPayload } from "./schema"
import { getChapterLayout, proposalBlockWeight } from "./layout"

type LineItem = Extract<PricingPayload, { mode: "line_items" }>["items"][number]

export type ReaderChapterSegment = {
  key: string
  chapter: ProposalChapter
  chapterIndex: number
  blocks: ProposalRenderSection[]
  pricingItems?: LineItem[]
  pricingShowTotal?: boolean
  continuation: boolean
  chunkIndex: number
  isLastChunk: boolean
}

export type ReaderSheet = {
  key: string
  segments: ReaderChapterSegment[]
  weight: number
  /** Major or reserved chapters should not share their opening sheet. */
  major: boolean
  /** Pricing and acceptance are kept alone and cannot absorb later chapters. */
  locked: boolean
}

const MAX_CHUNK_WEIGHT = 1150
const MAX_SHEET_WEIGHT = 1350
const MAX_PRICING_ROWS_PER_PAGE = 10
const MERGE_LEAD_WEIGHT = 450

type SegmentSpec = {
  blocks: ProposalRenderSection[]
  pricingItems?: LineItem[]
  pricingShowTotal?: boolean
}

function chunkBlocks(blocks: ProposalRenderSection[]): ProposalRenderSection[][] {
  const chunks: ProposalRenderSection[][] = []
  let current: ProposalRenderSection[] = []
  let currentWeight = 0

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current)
      current = []
      currentWeight = 0
    }
  }

  for (const block of blocks) {
    if (block.type === "bullet_list" && proposalBlockWeight(block) > MAX_CHUNK_WEIGHT) {
      flush()
      let itemGroup: string[] = []
      let itemWeight = 0
      const pushItems = () => {
        if (itemGroup.length === 0) return
        chunks.push([{ ...block, items: itemGroup }])
        itemGroup = []
        itemWeight = 0
      }
      for (const item of block.items) {
        const weight = Math.min(240, item.length + 35)
        if (itemGroup.length > 0 && itemWeight + weight > MAX_CHUNK_WEIGHT) pushItems()
        itemGroup.push(item)
        itemWeight += weight
      }
      pushItems()
      continue
    }

    if (block.type === "gallery" && proposalBlockWeight(block) > MAX_CHUNK_WEIGHT) {
      flush()
      const group: typeof block.images = []
      const pushImages = () => {
        if (group.length === 0) return
        chunks.push([{ ...block, images: [...group] }])
        group.length = 0
      }
      for (const image of block.images) {
        if (group.length >= 4) pushImages()
        group.push(image)
      }
      pushImages()
      continue
    }

    const weight = proposalBlockWeight(block)
    if (current.length > 0 && currentWeight + weight > MAX_CHUNK_WEIGHT) {
      // Do not strand a heading or divider at the end of a reader chunk.
      const carry: ProposalRenderSection[] = []
      while (
        current.length > 0 &&
        (current[current.length - 1].type === "heading" ||
          current[current.length - 1].type === "divider")
      ) {
        const last = current.pop()
        if (last) carry.unshift(last)
      }
      flush()
      current = carry
      currentWeight = carry.reduce((sum, item) => sum + proposalBlockWeight(item), 0)
    }
    current.push(block)
    currentWeight += weight
  }

  flush()
  return chunks.length > 0 ? chunks : [[]]
}

/**
 * Build book sheets from chapters. Short content chapters may share a sheet;
 * major, pricing and acceptance chapters get a fresh, visually distinct sheet.
 * Long chapters are split at safe block boundaries.
 */
export function buildReaderSheets(
  chapters: ProposalChapter[],
  pricing?: PricingPayload
): ReaderSheet[] {
  const sheets: ReaderSheet[] = []
  const lineItems = pricing?.mode === "line_items" ? pricing.items : null

  chapters.forEach((chapter, chapterIndex) => {
    const layout = getChapterLayout(chapter, chapterIndex)
    const reserved = chapter.kind !== "content"
    let specs: SegmentSpec[]

    if (chapter.kind === "pricing" && lineItems && lineItems.length > MAX_PRICING_ROWS_PER_PAGE) {
      specs = []
      for (let start = 0; start < lineItems.length; start += MAX_PRICING_ROWS_PER_PAGE) {
        const end = Math.min(lineItems.length, start + MAX_PRICING_ROWS_PER_PAGE)
        specs.push({
          blocks: start === 0 ? chapter.blocks : [],
          pricingItems: lineItems.slice(start, end),
          pricingShowTotal: end === lineItems.length,
        })
      }
    } else if (chapter.kind === "content" && !layout.hasImages) {
      specs = chunkBlocks(chapter.blocks).map((blocks) => ({ blocks }))
    } else {
      specs = [{ blocks: chapter.blocks }]
    }

    specs.forEach((spec, chunkIndex) => {
      const isLastChunk = chunkIndex === specs.length - 1
      const attachmentWeight = isLastChunk ? chapter.attachments.length * 80 : 0
      const segmentWeight =
        spec.blocks.reduce((sum, block) => sum + proposalBlockWeight(block), 0) +
        (spec.pricingItems?.length ?? 0) * 70 +
        (spec.pricingShowTotal ? 120 : 0) +
        attachmentWeight
      const segment: ReaderChapterSegment = {
        key: `${chapter.key}-chunk-${chunkIndex}`,
        chapter,
        chapterIndex,
        blocks: spec.blocks,
        pricingItems: spec.pricingItems,
        pricingShowTotal: spec.pricingShowTotal,
        continuation: chunkIndex > 0,
        chunkIndex,
        isLastChunk,
      }

      const forceNewSheet =
        sheets.length === 0 ||
        (chunkIndex === 0 && (layout.major || layout.newPage || reserved))
      const target = sheets[sheets.length - 1]
      const canShare =
        !forceNewSheet &&
        target != null &&
        !target.locked &&
        !target.major &&
        target.weight + segmentWeight <= MAX_SHEET_WEIGHT

      if (!canShare) {
        sheets.push({
          key: `sheet-${sheets.length}`,
          segments: [],
          weight: 0,
          major: false,
          locked: false,
        })
      }

      const sheet = sheets[sheets.length - 1]
      sheet.segments.push(segment)
      sheet.weight += segmentWeight
      if (chunkIndex === 0 && (layout.major || reserved)) sheet.major = true
      if (reserved && isLastChunk) sheet.locked = true
    })
  })

  // A very short lead-in (for example an introduction) should not occupy a
  // whole sheet immediately before a major image chapter. Merge it into the
  // next major sheet when both fit comfortably.
  for (let index = 0; index < sheets.length - 1; index += 1) {
    const lead = sheets[index]
    const next = sheets[index + 1]
    if (
      lead.segments.length === 1 &&
      !lead.major &&
      !lead.locked &&
      lead.weight <= MERGE_LEAD_WEIGHT &&
      next.major &&
      !next.locked &&
      lead.weight + next.weight <= MAX_SHEET_WEIGHT
    ) {
      next.segments.unshift(...lead.segments)
      next.weight += lead.weight
      sheets.splice(index, 1)
      index -= 1
    }
  }

  return sheets
}

/** First sheet index (excluding cover) for each chapter key. */
export function chapterStartSheetIndex(sheets: ReaderSheet[]): Map<string, number> {
  const starts = new Map<string, number>()
  sheets.forEach((sheet, sheetIndex) => {
    for (const segment of sheet.segments) {
      if (segment.chunkIndex === 0 && !starts.has(segment.chapter.key)) {
        starts.set(segment.chapter.key, sheetIndex)
      }
    }
  })
  return starts
}

/** TOC page number for a chapter (cover is page 1). */
export function chapterReaderPageNumber(starts: Map<string, number>, chapterKey: string): number {
  return (starts.get(chapterKey) ?? 0) + 2
}
