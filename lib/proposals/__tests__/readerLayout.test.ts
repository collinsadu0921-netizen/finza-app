import { describe, expect, it } from "@jest/globals"
import type { ProposalChapter } from "../composition"
import { buildReaderSheets, chapterReaderPageNumber, chapterStartSheetIndex } from "../readerLayout"

function chapter(overrides: Partial<ProposalChapter> = {}): ProposalChapter {
  return {
    key: "chapter-1",
    number: 1,
    title: "Introduction",
    eyebrow: "Chapter 01",
    kind: "content",
    blocks: [{ type: "paragraph", text: "A short paragraph." }],
    attachments: [],
    ...overrides,
  }
}

describe("proposal reader sheets", () => {
  it("shares a sheet between compatible short chapters", () => {
    const chapters = [
      chapter({ key: "a", number: 1, title: "Introduction" }),
      chapter({ key: "b", number: 2, title: "About the company" }),
      chapter({ key: "c", number: 3, title: "Client needs" }),
    ]
    const sheets = buildReaderSheets(chapters)
    expect(sheets).toHaveLength(1)
    expect(sheets[0].segments).toHaveLength(3)
    expect(sheets[0].segments.map((segment) => segment.chapter.key)).toEqual(["a", "b", "c"])
  })

  it("starts major chapters on their own sheet and locks pricing and acceptance", () => {
    const major = chapter({
      key: "major",
      number: 2,
      title: "Scope of work",
      blocks: Array.from({ length: 4 }, () => ({
        type: "paragraph" as const,
        text: "x".repeat(900),
      })),
    })
    const pricing = chapter({ key: "pricing", number: 3, title: "Investment and pricing", kind: "pricing" })
    const acceptance = chapter({ key: "acceptance", number: 4, title: "Acceptance", kind: "acceptance" })
    const sheets = buildReaderSheets([
      chapter({ key: "intro", number: 1, title: "Introduction" }),
      major,
      pricing,
      acceptance,
    ])
    expect(sheets.length).toBeGreaterThanOrEqual(4)
    expect(sheets.find((sheet) => sheet.segments.some((segment) => segment.chapter.key === "major"))?.major).toBe(true)
    expect(sheets.find((sheet) => sheet.segments.some((segment) => segment.chapter.key === "pricing"))?.locked).toBe(true)
    expect(sheets.find((sheet) => sheet.segments.some((segment) => segment.chapter.key === "acceptance"))?.locked).toBe(true)
  })

  it("splits long chapters into continuation segments", () => {
    const long = chapter({
      key: "long",
      number: 1,
      title: "Long programme",
      blocks: Array.from({ length: 18 }, (_, index) => ({
        type: "paragraph" as const,
        text: `Section ${index + 1}: ${"x".repeat(300)}`,
      })),
    })
    const sheets = buildReaderSheets([long])
    const segments = sheets.flatMap((sheet) => sheet.segments)
    expect(segments.length).toBeGreaterThan(1)
    expect(segments[0].continuation).toBe(false)
    expect(segments.slice(1).every((segment) => segment.continuation)).toBe(true)
  })

  it("maps chapter starts to TOC page numbers including the cover", () => {
    const chapters = [
      chapter({ key: "a", number: 1, title: "Introduction" }),
      chapter({ key: "b", number: 2, title: "About the company" }),
      chapter({
        key: "c",
        number: 3,
        title: "Scope of work",
        blocks: Array.from({ length: 4 }, () => ({
          type: "paragraph" as const,
          text: "x".repeat(900),
        })),
      }),
    ]
    const sheets = buildReaderSheets(chapters)
    const starts = chapterStartSheetIndex(sheets)
    expect(chapterReaderPageNumber(starts, "a")).toBe(2)
    expect(chapterReaderPageNumber(starts, "b")).toBe(2)
    expect(chapterReaderPageNumber(starts, "c")).toBeGreaterThanOrEqual(3)
  })

  it("splits long line-item pricing across reader sheets without losing items", () => {
    const items = Array.from({ length: 50 }, (_, index) => ({
      description: `Service line ${index + 1}`,
      quantity: 1,
      unit_price: 1000,
      discount_amount: 0,
      line_total: 1000,
    }))
    const sheets = buildReaderSheets(
      [chapter({ key: "pricing", number: 2, title: "Investment and pricing", kind: "pricing" })],
      { mode: "line_items", items }
    )
    const pricingSegments = sheets
      .flatMap((sheet) => sheet.segments)
      .filter((segment) => segment.pricingItems && segment.pricingItems.length > 0)
    expect(pricingSegments.length).toBe(5)
    expect(
      pricingSegments.reduce((sum, segment) => sum + (segment.pricingItems?.length ?? 0), 0)
    ).toBe(50)
    expect(pricingSegments[pricingSegments.length - 1].pricingShowTotal).toBe(true)
    expect(pricingSegments[0].pricingShowTotal).toBe(false)
  })

  it("merges a short lead-in into the next major image sheet", () => {
    const lead = chapter({ key: "lead", number: 1, title: "Introduction" })
    const imageChapter = chapter({
      key: "images",
      number: 2,
      title: "Facilities overview",
      blocks: [
        { type: "paragraph", text: "A".repeat(300) },
        { type: "image", src: "https://example.com/a.jpg", assetId: "asset-1" },
      ],
    })
    const sheets = buildReaderSheets([lead, imageChapter])
    expect(sheets).toHaveLength(1)
    expect(sheets[0].segments.map((segment) => segment.chapter.key)).toEqual(["lead", "images"])
  })
})
