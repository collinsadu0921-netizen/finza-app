import type { ProposalChapter } from "./composition"

export type ProposalChapterLayout = {
  weight: number
  lead: boolean
  twoColumn: boolean
  timeline: boolean
  scope: boolean
  hasImages: boolean
  imageText: boolean
  major: boolean
  newPage: boolean
}

const TIMELINE_TITLE = /timeline|schedule|milestone|phases/i
const SCOPE_TITLE = /scope|deliverable/i

function blockWeight(block: ProposalChapter["blocks"][number]): number {
  switch (block.type) {
    case "heading":
      return 60
    case "paragraph":
      return Math.min(900, block.text.trim().length)
    case "bullet_list":
      return block.items.reduce((sum, item) => sum + Math.min(240, item.length + 35), 0)
    case "image":
      return 650
    case "gallery":
      return 520 + block.images.length * 160
    case "divider":
      return 20
    default:
      return 0
  }
}

export const proposalBlockWeight = blockWeight

/**
 * Content-driven layout hints shared by the browser reader and PDF builder.
 * These do not change proposal content; they only decide presentation.
 */
export function getChapterLayout(chapter: ProposalChapter, index: number): ProposalChapterLayout {
  const weight =
    chapter.blocks.reduce((sum, block) => sum + blockWeight(block), 0) +
    (chapter.kind === "pricing" ? 900 : 0) +
    (chapter.kind === "acceptance" ? 500 : 0) +
    chapter.attachments.length * 80

  const bulletItems = chapter.blocks.flatMap((block) =>
    block.type === "bullet_list" ? block.items : []
  )
  const averageBulletLength =
    bulletItems.length > 0
      ? bulletItems.reduce((sum, item) => sum + item.length, 0) / bulletItems.length
      : 0

  const hasImages = chapter.blocks.some(
    (block) => block.type === "image" || block.type === "gallery"
  )
  const imageBlocks = chapter.blocks.filter((block) => block.type === "image")
  const paragraphBlocks = chapter.blocks.filter((block) => block.type === "paragraph")
  const imageText =
    chapter.kind === "content" &&
    imageBlocks.length === 1 &&
    paragraphBlocks.length >= 1 &&
    !chapter.blocks.some((block) => block.type === "gallery") &&
    weight < 1600
  const title = chapter.title
  const timeline = TIMELINE_TITLE.test(title)
  const scope = SCOPE_TITLE.test(title)
  const twoColumn =
    bulletItems.length >= 6 &&
    averageBulletLength <= 150 &&
    !timeline &&
    chapter.kind === "content"

  return {
    weight,
    lead: index === 0 && /introduction|overview|executive summary/i.test(title),
    twoColumn,
    timeline,
    scope,
    hasImages,
    imageText,
    major: weight >= 1800 || (hasImages && weight >= 900),
    newPage:
      index === 0 ||
      weight >= 2600 ||
      (hasImages && !imageText) ||
      chapter.kind === "pricing",
  }
}
