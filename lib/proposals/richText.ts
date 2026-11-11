import { z } from "zod"

/**
 * Restricted rich-text document stored inside `proposals.sections` JSONB.
 *
 * This is deliberately not arbitrary HTML and not raw ProseMirror JSON: the
 * server controls every node/mark that can be persisted, and both the React
 * readers and the PDF renderer consume the same AST.
 */
export const RICH_TEXT_VERSION = 1 as const

export const RICH_TEXT_MAX_BLOCKS = 200
export const RICH_TEXT_MAX_RUNS = 2_000
export const RICH_TEXT_MAX_LIST_ITEMS = 200
export const RICH_TEXT_MAX_TEXT_LENGTH = 60_000
export const RICH_TEXT_MAX_RUN_LENGTH = 20_000
export const RICH_TEXT_MAX_LINK_LENGTH = 2_048

/** Only absolute web/mail links are accepted. Relative and executable schemes are rejected. */
export function normalizeSafeHref(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw || raw.length > RICH_TEXT_MAX_LINK_LENGTH) return null
  if (/^mailto:/i.test(raw)) {
    const address = raw.slice(7).split("?")[0]?.trim() ?? ""
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return null
    return `mailto:${address}`
  }
  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (!url.hostname || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

const linkHrefSchema = z
  .string()
  .max(RICH_TEXT_MAX_LINK_LENGTH)
  .refine((value) => normalizeSafeHref(value) !== null, "Unsafe link")

export const richTextMarkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("underline") }),
  z.object({ type: z.literal("link"), href: linkHrefSchema }),
])

export const richTextRunSchema = z.union([
  z.object({
    type: z.literal("text"),
    text: z.string().min(1).max(RICH_TEXT_MAX_RUN_LENGTH),
    marks: z.array(richTextMarkSchema).max(4).optional(),
  }),
  z.object({ type: z.literal("break") }),
])

const runsSchema = z.array(richTextRunSchema).max(RICH_TEXT_MAX_RUNS)
const listSchema = z.array(runsSchema).max(RICH_TEXT_MAX_LIST_ITEMS)

export const richTextBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), runs: runsSchema }),
  z.object({
    type: z.literal("heading"),
    level: z.union([z.literal(2), z.literal(3)]),
    runs: runsSchema,
  }),
  z.object({ type: z.literal("bullet_list"), items: listSchema }),
  z.object({ type: z.literal("ordered_list"), items: listSchema }),
])

export const proposalRichTextDocSchema = z.object({
  version: z.literal(RICH_TEXT_VERSION),
  blocks: z.array(richTextBlockSchema).max(RICH_TEXT_MAX_BLOCKS),
})

export type RichTextMark = z.infer<typeof richTextMarkSchema>
export type RichTextRun = z.infer<typeof richTextRunSchema>
export type RichTextBlock = z.infer<typeof richTextBlockSchema>
export type ProposalRichTextDoc = z.infer<typeof proposalRichTextDocSchema>

export function emptyRichTextDoc(): ProposalRichTextDoc {
  return { version: RICH_TEXT_VERSION, blocks: [] }
}

const MARK_ORDER: Record<RichTextMark["type"], number> = {
  bold: 0,
  italic: 1,
  underline: 2,
  link: 3,
}

function normalizeMark(mark: RichTextMark): RichTextMark | null {
  if (mark.type === "link") {
    const href = normalizeSafeHref(mark.href)
    return href ? { type: "link", href } : null
  }
  return mark
}

function normalizeMarks(marks: RichTextMark[] | undefined): RichTextMark[] | undefined {
  if (!marks || marks.length === 0) return undefined
  const byType = new Map<RichTextMark["type"], RichTextMark>()
  for (const mark of marks) {
    const normalized = normalizeMark(mark)
    if (!normalized) continue
    byType.set(normalized.type, normalized)
  }
  if (byType.size === 0) return undefined
  return [...byType.values()].sort((a, b) => MARK_ORDER[a.type] - MARK_ORDER[b.type])
}

function sameMarks(a: RichTextMark[] | undefined, b: RichTextMark[] | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

function cleanText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
}

function normalizeRuns(runs: RichTextRun[]): RichTextRun[] {
  const out: RichTextRun[] = []
  for (const run of runs) {
    if (run.type === "break") {
      if (out.length > 0 && out[out.length - 1].type !== "break") out.push({ type: "break" })
      continue
    }
    const text = cleanText(run.text)
    if (!text) continue
    const marks = normalizeMarks(run.marks)
    const previous = out[out.length - 1]
    if (previous?.type === "text" && sameMarks(previous.marks, marks)) {
      previous.text = `${previous.text}${text}`.slice(0, RICH_TEXT_MAX_RUN_LENGTH)
      continue
    }
    out.push({ type: "text", text: text.slice(0, RICH_TEXT_MAX_RUN_LENGTH), ...(marks ? { marks } : {}) })
    if (out.length >= RICH_TEXT_MAX_RUNS) break
  }
  while (out.length > 0 && out[out.length - 1].type === "break") out.pop()
  return out
}

function normalizeBlock(block: RichTextBlock): RichTextBlock | null {
  if (block.type === "bullet_list" || block.type === "ordered_list") {
    const items = block.items
      .map((item) => normalizeRuns(item))
      .filter((item) => item.length > 0)
      .slice(0, RICH_TEXT_MAX_LIST_ITEMS)
    return items.length > 0 ? { type: block.type, items } : null
  }
  const runs = normalizeRuns(block.runs)
  if (runs.length === 0) return null
  if (block.type === "heading") {
    return { type: "heading", level: block.level === 3 ? 3 : 2, runs }
  }
  return { type: "paragraph", runs }
}

function sanitizeRawRuns(value: unknown): unknown[] {
  if (!Array.isArray(value)) return []
  const out: unknown[] = []
  for (const run of value) {
    if (!run || typeof run !== "object") continue
    const record = run as Record<string, unknown>
    if (record.type === "break") {
      out.push({ type: "break" })
      continue
    }
    if (record.type !== "text" || typeof record.text !== "string") continue
    const marks: unknown[] = []
    if (Array.isArray(record.marks)) {
      for (const mark of record.marks) {
        if (!mark || typeof mark !== "object") continue
        const m = mark as Record<string, unknown>
        if (m.type === "bold" || m.type === "italic" || m.type === "underline") {
          marks.push({ type: m.type })
        } else if (m.type === "link") {
          const href = normalizeSafeHref(m.href)
          if (href) marks.push({ type: "link", href })
        }
      }
    }
    out.push({
      type: "text",
      text: record.text,
      ...(marks.length > 0 ? { marks } : {}),
    })
  }
  return out
}

function sanitizeRawRichText(value: unknown): unknown {
  if (!value || typeof value !== "object") return value
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.blocks)) return value
  const blocks: unknown[] = []
  for (const block of record.blocks) {
    if (!block || typeof block !== "object") continue
    const b = block as Record<string, unknown>
    if (b.type === "paragraph") {
      blocks.push({ type: "paragraph", runs: sanitizeRawRuns(b.runs) })
    } else if (b.type === "heading") {
      blocks.push({
        type: "heading",
        level: Number(b.level) === 3 ? 3 : 2,
        runs: sanitizeRawRuns(b.runs),
      })
    } else if (b.type === "bullet_list" || b.type === "ordered_list") {
      const items = Array.isArray(b.items)
        ? b.items.map((item) => sanitizeRawRuns(item)).filter((item) => item.length > 0)
        : []
      blocks.push({ type: b.type, items })
    }
  }
  return { version: RICH_TEXT_VERSION, blocks }
}

export function normalizeRichTextDoc(value: unknown): ProposalRichTextDoc {
  if (typeof value === "string") return plainTextToRichTextDoc(value)
  const parsed = proposalRichTextDocSchema.safeParse(sanitizeRawRichText(value))
  if (!parsed.success) return emptyRichTextDoc()
  const blocks = parsed.data.blocks
    .map((block) => normalizeBlock(block))
    .filter((block): block is RichTextBlock => block !== null)
    .slice(0, RICH_TEXT_MAX_BLOCKS)
  return { version: RICH_TEXT_VERSION, blocks }
}

/** Strict server-side validator. Throws on unsafe/unknown formatting. */
export function assertRichTextDoc(value: unknown): ProposalRichTextDoc {
  const parsed = proposalRichTextDocSchema.parse(value)
  return normalizeRichTextDoc(parsed)
}

export function textFromRuns(runs: RichTextRun[]): string {
  return runs
    .map((run) => (run.type === "break" ? "\n" : run.text))
    .join("")
}

export function richTextDocToPlainText(doc: ProposalRichTextDoc | null | undefined): string {
  const normalized = normalizeRichTextDoc(doc ?? emptyRichTextDoc())
  const blocks: string[] = []
  for (const block of normalized.blocks) {
    if (block.type === "paragraph" || block.type === "heading") {
      const text = textFromRuns(block.runs)
      if (text.trim()) blocks.push(text)
      continue
    }
    const items = block.items
      .map((item, index) => {
        const text = textFromRuns(item)
        if (!text.trim()) return null
        return `${block.type === "ordered_list" ? `${index + 1}. ` : "• "}${text}`
      })
      .filter((item): item is string => item !== null)
    if (items.length > 0) blocks.push(items.join("\n"))
  }
  return blocks.join("\n\n").trim()
}

export function richTextDocHasText(doc: ProposalRichTextDoc | null | undefined): boolean {
  return richTextDocToPlainText(doc).length > 0
}

export function richTextDocWeight(doc: ProposalRichTextDoc | null | undefined): number {
  const normalized = normalizeRichTextDoc(doc ?? emptyRichTextDoc())
  let weight = 0
  for (const block of normalized.blocks) {
    if (block.type === "bullet_list" || block.type === "ordered_list") {
      weight += 30 + block.items.reduce((sum, item) => sum + Math.min(600, textFromRuns(item).length + 20), 0)
    } else {
      weight += Math.min(1_200, textFromRuns(block.runs).length + (block.type === "heading" ? 60 : 20))
    }
  }
  return weight
}

export function plainTextToRichTextDoc(value: string | null | undefined): ProposalRichTextDoc {
  const text = cleanText(String(value ?? "")).trim()
  if (!text) return emptyRichTextDoc()
  const paragraphs = text.split(/\n{2,}/)
  const blocks: RichTextBlock[] = []
  for (const paragraph of paragraphs) {
    const lines = paragraph.split("\n")
    const runs: RichTextRun[] = []
    lines.forEach((line, index) => {
      if (index > 0) runs.push({ type: "break" })
      if (line) runs.push({ type: "text", text: line })
    })
    const normalized = normalizeRuns(runs)
    if (normalized.length > 0) blocks.push({ type: "paragraph", runs: normalized })
  }
  return { version: RICH_TEXT_VERSION, blocks }
}

function splitRunsForWidth(runs: RichTextRun[], maxChars: number): RichTextRun[][] {
  const chunks: RichTextRun[][] = []
  let current: RichTextRun[] = []
  let currentLength = 0

  const flush = () => {
    const normalized = normalizeRuns(current)
    if (normalized.length > 0) chunks.push(normalized)
    current = []
    currentLength = 0
  }

  for (const run of runs) {
    if (run.type === "break") {
      current.push(run)
      currentLength += 1
      continue
    }
    let remaining = run.text
    while (remaining.length > 0) {
      const space = maxChars - currentLength
      if (space <= 0) {
        flush()
        continue
      }
      if (remaining.length <= space) {
        current.push({ type: "text", text: remaining, ...(run.marks ? { marks: run.marks } : {}) })
        currentLength += remaining.length
        remaining = ""
        continue
      }
      let splitAt = remaining.lastIndexOf(" ", space)
      if (splitAt < Math.max(24, Math.floor(space * 0.55))) splitAt = space
      const piece = remaining.slice(0, splitAt).trimEnd()
      if (piece) {
        current.push({ type: "text", text: piece, ...(run.marks ? { marks: run.marks } : {}) })
        currentLength += piece.length
      }
      remaining = remaining.slice(splitAt).trimStart()
      flush()
    }
  }
  flush()
  return chunks
}

/** Split a document at block boundaries (and oversized paragraphs) for reader/PDF pagination. */
export function splitRichTextDoc(
  doc: ProposalRichTextDoc | null | undefined,
  maxWeight = 1_100
): ProposalRichTextDoc[] {
  const normalized = normalizeRichTextDoc(doc ?? emptyRichTextDoc())
  if (normalized.blocks.length === 0) return []
  const out: ProposalRichTextDoc[] = []
  let current: RichTextBlock[] = []
  let currentWeight = 0

  const flush = () => {
    if (current.length > 0) out.push({ version: RICH_TEXT_VERSION, blocks: current })
    current = []
    currentWeight = 0
  }

  for (const block of normalized.blocks) {
    const weight = richTextDocWeight({ version: RICH_TEXT_VERSION, blocks: [block] })
    if (weight <= maxWeight && currentWeight + weight <= maxWeight) {
      current.push(block)
      currentWeight += weight
      continue
    }
    flush()

    if (block.type === "bullet_list" || block.type === "ordered_list") {
      let items: RichTextRun[][] = []
      let itemWeight = 0
      for (const item of block.items) {
        const itemW = Math.min(600, textFromRuns(item).length + 20) + 30
        if (items.length > 0 && itemWeight + itemW > maxWeight) {
          out.push({ version: RICH_TEXT_VERSION, blocks: [{ type: block.type, items }] })
          items = []
          itemWeight = 0
        }
        items.push(item)
        itemWeight += itemW
      }
      if (items.length > 0) out.push({ version: RICH_TEXT_VERSION, blocks: [{ type: block.type, items }] })
      continue
    }

    if (weight > maxWeight) {
      const chunks = splitRunsForWidth(block.runs, Math.max(240, maxWeight - 40))
      chunks.forEach((runs, index) => {
        out.push({
          version: RICH_TEXT_VERSION,
          blocks: [
            block.type === "heading" && index === 0
              ? { type: "heading", level: block.level, runs }
              : { type: "paragraph", runs },
          ],
        })
      })
      continue
    }

    current.push(block)
    currentWeight = weight
  }
  flush()
  return out
}

/* -------------------------------------------------------------------------- */
/* ProseMirror (Tiptap) adapters                                               */
/* -------------------------------------------------------------------------- */

type PmMark = { type?: string; attrs?: Record<string, unknown> }
type PmNode = {
  type?: string
  attrs?: Record<string, unknown>
  content?: PmNode[]
  text?: string
  marks?: PmMark[]
}

function pmMarksToRich(marks: PmMark[] | undefined): RichTextMark[] | undefined {
  const out: RichTextMark[] = []
  for (const mark of marks ?? []) {
    if (mark.type === "bold" || mark.type === "italic" || mark.type === "underline") {
      out.push({ type: mark.type })
    } else if (mark.type === "link") {
      const href = normalizeSafeHref(mark.attrs?.href)
      if (href) out.push({ type: "link", href })
    }
  }
  return normalizeMarks(out)
}

function pmInlineRuns(nodes: PmNode[] | undefined): RichTextRun[] {
  const runs: RichTextRun[] = []
  for (const node of nodes ?? []) {
    if (node.type === "text" && typeof node.text === "string" && node.text.length > 0) {
      runs.push({
        type: "text",
        text: node.text,
        ...(pmMarksToRich(node.marks) ? { marks: pmMarksToRich(node.marks) } : {}),
      })
    } else if (node.type === "hardBreak") {
      runs.push({ type: "break" })
    } else if (node.content) {
      runs.push(...pmInlineRuns(node.content))
    }
  }
  return normalizeRuns(runs)
}

function pmListItems(node: PmNode): RichTextRun[][] {
  const items: RichTextRun[][] = []
  for (const listItem of node.content ?? []) {
    if (listItem.type !== "listItem") continue
    const runs: RichTextRun[] = []
    for (const child of listItem.content ?? []) {
      if (child.type === "paragraph") {
        if (runs.length > 0) runs.push({ type: "break" })
        runs.push(...pmInlineRuns(child.content))
      } else if (child.type === "bulletList" || child.type === "orderedList") {
        items.push(...pmListItems(child))
      }
    }
    const normalized = normalizeRuns(runs)
    if (normalized.length > 0) items.push(normalized)
  }
  return items
}

/** Convert Tiptap/ProseMirror JSON into the restricted AST, dropping unsupported nodes/marks. */
export function richTextDocFromProseMirror(value: unknown): ProposalRichTextDoc {
  const doc = value && typeof value === "object" ? (value as PmNode) : null
  if (!doc || doc.type !== "doc") return emptyRichTextDoc()
  const blocks: RichTextBlock[] = []

  const visit = (node: PmNode) => {
    if (node.type === "paragraph") {
      const runs = pmInlineRuns(node.content)
      if (runs.length > 0) blocks.push({ type: "paragraph", runs })
      return
    }
    if (node.type === "heading") {
      const level = Number(node.attrs?.level) === 3 ? 3 : 2
      const runs = pmInlineRuns(node.content)
      if (runs.length > 0) blocks.push({ type: "heading", level, runs })
      return
    }
    if (node.type === "bulletList" || node.type === "orderedList") {
      const items = pmListItems(node)
      if (items.length > 0) {
        blocks.push({
          type: node.type === "bulletList" ? "bullet_list" : "ordered_list",
          items,
        })
      }
      return
    }
    for (const child of node.content ?? []) visit(child)
  }

  for (const child of doc.content ?? []) visit(child)
  return normalizeRichTextDoc({ version: RICH_TEXT_VERSION, blocks })
}

function richMarksToPm(marks: RichTextMark[] | undefined): PmMark[] | undefined {
  if (!marks || marks.length === 0) return undefined
  return marks.map((mark) =>
    mark.type === "link"
      ? {
          type: "link",
          attrs: {
            href: mark.href,
            target: "_blank",
            rel: "noopener noreferrer nofollow",
          },
        }
      : { type: mark.type }
  )
}

function runsToPm(runs: RichTextRun[]): PmNode[] {
  const content: PmNode[] = []
  for (const run of runs) {
    if (run.type === "break") {
      content.push({ type: "hardBreak" })
      continue
    }
    if (!run.text) continue
    const marks = richMarksToPm(run.marks)
    content.push({ type: "text", text: run.text, ...(marks ? { marks } : {}) })
  }
  return content
}

/** Convert the restricted AST into Tiptap-compatible ProseMirror JSON. */
export function richTextDocToProseMirror(doc: ProposalRichTextDoc | null | undefined): PmNode {
  const normalized = normalizeRichTextDoc(doc ?? emptyRichTextDoc())
  const content: PmNode[] = []
  for (const block of normalized.blocks) {
    if (block.type === "paragraph") {
      content.push({ type: "paragraph", content: runsToPm(block.runs) })
      continue
    }
    if (block.type === "heading") {
      content.push({ type: "heading", attrs: { level: block.level }, content: runsToPm(block.runs) })
      continue
    }
    content.push({
      type: block.type === "bullet_list" ? "bulletList" : "orderedList",
      content: block.items.map((item) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: runsToPm(item) }],
      })),
    })
  }
  if (content.length === 0) content.push({ type: "paragraph" })
  return { type: "doc", content }
}

/* -------------------------------------------------------------------------- */
/* Safe HTML for PDF                                                           */
/* -------------------------------------------------------------------------- */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function runsToHtml(runs: RichTextRun[]): string {
  let html = ""
  for (const run of runs) {
    if (run.type === "break") {
      html += "<br/>"
      continue
    }
    let value = escapeHtml(run.text)
    const marks = new Set((run.marks ?? []).map((mark) => mark.type))
    if (marks.has("bold")) value = `<strong>${value}</strong>`
    if (marks.has("italic")) value = `<em>${value}</em>`
    if (marks.has("underline")) value = `<u>${value}</u>`
    const link = run.marks?.find((mark) => mark.type === "link")
    if (link && link.type === "link") {
      const href = normalizeSafeHref(link.href)
      if (href) {
        value = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${value}</a>`
      }
    }
    html += value
  }
  return html
}

/** Escaped, controlled HTML for Chromium PDF rendering. */
export function richTextDocToHtml(doc: ProposalRichTextDoc | null | undefined): string {
  const normalized = normalizeRichTextDoc(doc ?? emptyRichTextDoc())
  return normalized.blocks
    .map((block) => {
      if (block.type === "paragraph") {
        return `<p class="pdf-paragraph pdf-rich-paragraph">${runsToHtml(block.runs)}</p>`
      }
      if (block.type === "heading") {
        const tag = block.level === 3 ? "h4" : "h3"
        const className = block.level === 3 ? "pdf-rich-subheading" : "pdf-rich-heading"
        return `<${tag} class="${className}">${runsToHtml(block.runs)}</${tag}>`
      }
      const tag = block.type === "bullet_list" ? "ul" : "ol"
      const className = block.type === "bullet_list" ? "pdf-list pdf-rich-list" : "pdf-list pdf-rich-list pdf-rich-list--ordered"
      return `<${tag} class="${className}">${block.items
        .map((item) => `<li>${runsToHtml(item)}</li>`)
        .join("")}</${tag}>`
    })
    .join("\n")
}
