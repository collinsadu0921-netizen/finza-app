/** Collapse whitespace to a single line. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/**
 * First sentence + length cap — invoice PDF closing block fits on one page.
 */
export function invoiceTermsSingleSentence(raw: string): string {
  const line = collapseWhitespace(raw)
  if (!line) return ""
  const parts = line.split(/(?<=[.!?])\s+/)
  const first = (parts[0] ?? line).trim()
  return first.length > 260 ? `${first.slice(0, 257).trimEnd()}…` : first
}

export function invoiceFooterSingleLine(raw: string, maxLen = 300): string {
  const line = collapseWhitespace(raw)
  if (line.length <= maxLen) return line
  return `${line.slice(0, maxLen - 1).trimEnd()}…`
}
