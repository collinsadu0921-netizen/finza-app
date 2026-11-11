import { escapeHtml } from "./htmlEscape"

export type InlineFormatSegment = {
  text: string
  bold: boolean
}

const BOLD_PATTERN = /\*\*([\s\S]+?)\*\*/g

/** Parse the minimal, storage-safe bold syntax used in proposal content. */
export function parseInlineFormatting(value: string): InlineFormatSegment[] {
  const text = value ?? ""
  if (!text) return []
  const segments: InlineFormatSegment[] = []
  let lastIndex = 0
  for (const match of text.matchAll(BOLD_PATTERN)) {
    const index = match.index ?? 0
    if (index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, index), bold: false })
    }
    segments.push({ text: match[1], bold: true })
    lastIndex = index + match[0].length
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), bold: false })
  }
  return segments.length > 0 ? segments : [{ text, bold: false }]
}

/** Escape user content first, then promote paired ** markers to <strong>. */
export function inlineFormattingToHtml(value: string): string {
  return escapeHtml(value ?? "").replace(BOLD_PATTERN, "<strong>$1</strong>")
}

export type BoldSelectionResult = {
  value: string
  selectionStart: number
  selectionEnd: number
}

function toggleBoldRange(value: string, start: number, end: number): BoldSelectionResult {
  if (start === end) {
    return {
      value: `${value.slice(0, start)}****${value.slice(end)}`,
      selectionStart: start + 2,
      selectionEnd: start + 2,
    }
  }

  const selected = value.slice(start, end)
  if (selected.length >= 4 && selected.startsWith("**") && selected.endsWith("**")) {
    return {
      value: `${value.slice(0, start)}${selected.slice(2, -2)}${value.slice(end)}`,
      selectionStart: start,
      selectionEnd: end - 4,
    }
  }

  if (start >= 2 && value.slice(start - 2, start) === "**" && value.slice(end, end + 2) === "**") {
    return {
      value: `${value.slice(0, start - 2)}${selected}${value.slice(end + 2)}`,
      selectionStart: start - 2,
      selectionEnd: end - 2,
    }
  }

  return {
    value: `${value.slice(0, start)}**${selected}**${value.slice(end)}`,
    selectionStart: start + 2,
    selectionEnd: end + 2,
  }
}

function toggleBoldLines(value: string, start: number, end: number): BoldSelectionResult {
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1
  const nextNewline = value.indexOf("\n", end)
  const lineEnd = nextNewline === -1 ? value.length : nextNewline
  const block = value.slice(lineStart, lineEnd)
  const lines = block.split("\n").map((line) => {
    const parts = line.match(/^(\s*)([\s\S]*?)(\s*)$/)
    if (!parts) return line
    const [, leading, body, trailing] = parts
    if (!body) return line
    if (body.length >= 4 && body.startsWith("**") && body.endsWith("**")) {
      return `${leading}${body.slice(2, -2)}${trailing}`
    }
    return `${leading}**${body}**${trailing}`
  })
  const nextBlock = lines.join("\n")
  return {
    value: `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`,
    selectionStart: lineStart,
    selectionEnd: lineStart + nextBlock.length,
  }
}

/**
 * Wrap or unwrap selected text with ** markers. When `perLine` is enabled
 * (bullet lists), multi-line selections format each non-empty line separately.
 */
export function toggleBoldSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  options?: { perLine?: boolean }
): BoldSelectionResult {
  const start = Math.max(0, Math.min(selectionStart, value.length))
  const end = Math.max(start, Math.min(selectionEnd, value.length))
  if (options?.perLine && value.slice(start, end).includes("\n")) {
    return toggleBoldLines(value, start, end)
  }
  return toggleBoldRange(value, start, end)
}
