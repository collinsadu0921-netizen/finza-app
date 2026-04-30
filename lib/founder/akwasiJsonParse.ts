export function safeParseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}
