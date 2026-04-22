import { escapeHtml } from "./htmlEscape"

export type CustomPricingBlock =
  | { type: "spacer" }
  | { type: "heading"; text: string }
  | { type: "rate_row"; label: string; value: string }
  | { type: "bullet"; text: string }
  | { type: "paragraph"; text: string }

/**
 * Groups consecutive blocks for layout: rate rows → one card; bullets → one list.
 * Used by React and PDF so structure stays aligned.
 */
export type CustomPricingDisplayChunk =
  | { kind: "rate_group"; rows: { label: string; value: string }[] }
  | { kind: "bullet_group"; items: string[] }
  | { kind: "single"; block: CustomPricingBlock }

export function chunkCustomPricingForDisplay(blocks: CustomPricingBlock[]): CustomPricingDisplayChunk[] {
  const chunks: CustomPricingDisplayChunk[] = []
  let i = 0
  while (i < blocks.length) {
    const b = blocks[i]
    if (b.type === "rate_row") {
      const rows: { label: string; value: string }[] = []
      while (i < blocks.length && blocks[i].type === "rate_row") {
        const r = blocks[i] as Extract<CustomPricingBlock, { type: "rate_row" }>
        rows.push({ label: r.label, value: r.value })
        i += 1
      }
      chunks.push({ kind: "rate_group", rows })
      continue
    }
    if (b.type === "bullet") {
      const items: string[] = []
      while (i < blocks.length && blocks[i].type === "bullet") {
        items.push((blocks[i] as Extract<CustomPricingBlock, { type: "bullet" }>).text)
        i += 1
      }
      chunks.push({ kind: "bullet_group", items })
      continue
    }
    chunks.push({ kind: "single", block: b })
    i += 1
  }
  return chunks
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

function stripBulletPrefix(line: string): string | null {
  const t = line.replace(/^\s+/, "")
  if (t.startsWith("- ")) return t.slice(2).trim()
  if (t.startsWith("• ")) return t.slice(2).trim()
  if (t.startsWith("* ")) return t.slice(2).trim()
  return null
}

/** First `:` splits label from value; both sides must be non-empty. Skips URL-like lines (`://`). */
function tryRateRow(line: string): { label: string; value: string } | null {
  if (/\/\//.test(line)) return null
  const idx = line.indexOf(":")
  if (idx <= 0) return null
  const label = line.slice(0, idx).trim()
  const value = line.slice(idx + 1).trim()
  if (!label || !value) return null
  return { label, value }
}

/**
 * Short standalone line without a colon — treated as a section title
 * (e.g. "Pricing Schedule"). Longer / more complex lines stay paragraphs.
 */
function looksLikeHeading(line: string): boolean {
  const t = line.trim()
  if (!t || t.includes(":")) return false
  if (t.length > 60) return false
  if (wordCount(t) > 8) return false
  if ((t.match(/,/g) || []).length >= 2) return false
  return true
}

/**
 * Parse custom pricing notes into blocks for React / PDF.
 * Rules: blank line → spacer; `- ` / `• ` / `* ` → bullet; `Label: value` → rate_row;
 * short non-colon line → heading; else paragraph.
 */
export function parseCustomPricingNotes(raw: string | null | undefined): CustomPricingBlock[] {
  const text = raw ?? ""
  const lines = text.split(/\n/)
  const out: CustomPricingBlock[] = []

  for (const line of lines) {
    if (line.trim() === "") {
      out.push({ type: "spacer" })
      continue
    }
    const bulletBody = stripBulletPrefix(line)
    if (bulletBody !== null) {
      out.push({ type: "bullet", text: bulletBody })
      continue
    }
    const rate = tryRateRow(line)
    if (rate) {
      out.push({ type: "rate_row", label: rate.label, value: rate.value })
      continue
    }
    if (looksLikeHeading(line)) {
      out.push({ type: "heading", text: line.trim() })
      continue
    }
    out.push({ type: "paragraph", text: line.trim() })
  }

  return out
}

/** HTML for PDF / print — uses {@link chunkCustomPricingForDisplay} so layout matches React. */
export function customPricingNotesToHtml(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) {
    return `<p class="cp-p muted">Custom pricing — see discussion.</p>`
  }

  const chunks = chunkCustomPricingForDisplay(parseCustomPricingNotes(raw))
  const parts: string[] = []

  for (const chunk of chunks) {
    if (chunk.kind === "rate_group") {
      const inner = chunk.rows
        .map(
          (r) =>
            `<div class="cp-rate-row"><span class="cp-label">${escapeHtml(r.label)}</span><span class="cp-value">${escapeHtml(r.value)}</span></div>`
        )
        .join("")
      parts.push(`<div class="cp-rate-group">${inner}</div>`)
      continue
    }
    if (chunk.kind === "bullet_group") {
      const lis = chunk.items.map((t) => `<li class="cp-li">${escapeHtml(t)}</li>`).join("")
      parts.push(`<ul class="cp-ul">${lis}</ul>`)
      continue
    }

    const b = chunk.block
    switch (b.type) {
      case "spacer":
        parts.push(`<div class="cp-spacer" aria-hidden="true"></div>`)
        break
      case "heading":
        parts.push(`<p class="cp-h">${escapeHtml(b.text)}</p>`)
        break
      case "paragraph":
        parts.push(`<p class="cp-p">${escapeHtml(b.text)}</p>`)
        break
      default:
        break
    }
  }

  return parts.join("\n")
}
