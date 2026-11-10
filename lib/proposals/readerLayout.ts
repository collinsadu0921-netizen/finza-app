import type { ProposalChapter } from "./composition"
import type { ProposalRenderSection } from "./renderModel"
import { getChapterLayout, proposalBlockWeight } from "./layout"

export type ReaderChapterSegment = {
  key: string
  chapter: ProposalChapter
  chapterIndex: number
  blocks: ProposalRenderSection[]
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
export function buildReaderSheets(chapters: ProposalChapter[]): ReaderSheet[] {
  const sheets: ReaderSheet[] = []

  chapters.forEach((chapter, chapterIndex) => {
    const layout = getChapterLayout(chapter, chapterIndex)
    const chunks = chapter.kind === "content" ? chunkBlocks(chapter.blocks) : [chapter.blocks]
    const reserved = chapter.kind !== "content"

    chunks.forEach((blocks, chunkIndex) => {
      const isLastChunk = chunkIndex === chunks.length - 1
      const attachmentWeight = isLastChunk ? chapter.attachments.length * 80 : 0
      const segmentWeight =
        blocks.reduce((sum, block) => sum + proposalBlockWeight(block), 0) + attachmentWeight
      const segment: ReaderChapterSegment = {
        key: `${chapter.key}-chunk-${chunkIndex}`,
        chapter,
        chapterIndex,
        blocks,
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
