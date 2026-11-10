import { describe, expect, it } from "@jest/globals"
import { getChapterLayout } from "../layout"
import type { ProposalChapter } from "../composition"

function chapter(overrides: Partial<ProposalChapter> = {}): ProposalChapter {
  return {
    key: "chapter-1",
    number: 1,
    title: "Scope of work",
    eyebrow: "Chapter 01",
    kind: "content",
    blocks: [{ type: "paragraph", text: "A short paragraph." }],
    attachments: [],
    ...overrides,
  }
}

describe("proposal chapter layout", () => {
  it("keeps a short first chapter on a new page but lets later short chapters flow", () => {
    const first = getChapterLayout(chapter({ number: 1 }), 0)
    const later = getChapterLayout(chapter({ number: 2, title: "Terms" }), 1)
    expect(first.newPage).toBe(true)
    expect(later.newPage).toBe(false)
  })

  it("gives long and image-rich chapters a new page when visually justified", () => {
    const long = getChapterLayout(
      chapter({
        blocks: Array.from({ length: 10 }, () => ({
          type: "paragraph" as const,
          text: "x".repeat(320),
        })),
      }),
      1
    )
    expect(long.weight).toBeGreaterThan(2500)
    expect(long.newPage).toBe(true)

    const images = getChapterLayout(
      chapter({
        blocks: [
          { type: "paragraph", text: "Project context." },
          { type: "image", src: "https://example.com/image.png", assetId: "asset-1" },
        ],
      }),
      1
    )
    expect(images.hasImages).toBe(true)
    expect(images.newPage).toBe(true)
    expect(images.imageText).toBe(true)

    const imageText = getChapterLayout(
      chapter({
        blocks: [
          { type: "paragraph", text: "Project context and an editorial introduction." },
          { type: "image", src: "https://example.com/image.png", assetId: "asset-1" },
        ],
      }),
      1
    )
    expect(imageText.imageText).toBe(true)
  })

  it("uses two columns for longer lists of short bullets and recognises timelines", () => {
    const twoCol = getChapterLayout(
      chapter({
        blocks: [
          {
            type: "bullet_list",
            items: ["Offices", "Washrooms", "Meeting rooms", "Common areas", "Kitchenette", "Reception"],
          },
        ],
      }),
      1
    )
    expect(twoCol.twoColumn).toBe(true)

    const timeline = getChapterLayout(
      chapter({ title: "Timeline and milestones", blocks: [{ type: "paragraph", text: "Week 1: mobilise." }] }),
      2
    )
    expect(timeline.timeline).toBe(true)
    expect(timeline.twoColumn).toBe(false)
  })
})
