/**
 * Read fetch Response as JSON; avoids SyntaxError when the server returns HTML/text (e.g. Next error page).
 */
export async function readApiJson<T = unknown>(
  res: Response
): Promise<
  | { ok: true; data: T; status: number }
  | { ok: false; status: number; parseError: true; snippet: string }
> {
  const text = await res.text()
  const snippet = text.replace(/\s+/g, " ").trim().slice(0, 180)
  if (!text.trim()) {
    return { ok: false, status: res.status, parseError: true, snippet: "(empty body)" }
  }
  try {
    return { ok: true, data: JSON.parse(text) as T, status: res.status }
  } catch {
    return { ok: false, status: res.status, parseError: true, snippet }
  }
}
