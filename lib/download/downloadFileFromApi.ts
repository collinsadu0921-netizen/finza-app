import { parseFilenameFromContentDisposition } from "@/lib/invoices/invoiceDocumentAttachment"

export type DownloadFileFromApiOptions = {
  fallbackFilename: string
  /**
   * When the response includes a non-empty Blob.type, verify it starts with this prefix
   * (e.g. "application/pdf"). Omit for CSV endpoints that may use varying MIME types.
   */
  expectedMimePrefix?: string
  method?: "GET" | "POST"
  body?: BodyInit
  headers?: HeadersInit
}

async function readErrorMessage(res: Response): Promise<string> {
  let raw = ""
  try {
    raw = await res.text()
  } catch {
    return `Request failed (${res.status})`
  }
  const trimmed = raw.trim()
  if (trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(trimmed) as Record<string, unknown>
      const parts = [j.error, j.message, j.code, j.hint].filter(
        (x): x is string => typeof x === "string" && x.length > 0
      )
      if (parts.length > 0) return parts.join(" — ")
    } catch {
      /* fall through */
    }
  }
  if (trimmed.length > 0 && trimmed.length < 800) return trimmed
  return `Request failed (${res.status})`
}

/**
 * Browser-only: fetches a file from same-origin API routes with cookies, triggers download,
 * and throws readable errors for JSON/text failure bodies (no window.open).
 */
export async function downloadFileFromApi(url: string, options: DownloadFileFromApiOptions): Promise<void> {
  const { fallbackFilename, expectedMimePrefix, method = "GET", body, headers } = options

  const res = await fetch(url, {
    credentials: "include",
    method,
    body: method === "POST" ? body : undefined,
    headers,
  })

  if (!res.ok) {
    throw new Error(await readErrorMessage(res))
  }

  const blob = await res.blob()
  if (
    expectedMimePrefix &&
    blob.type &&
    blob.type.length > 0 &&
    !blob.type.startsWith(expectedMimePrefix)
  ) {
    throw new Error(`Unexpected file type (${blob.type}). Expected ${expectedMimePrefix}.`)
  }

  const fromHeader = parseFilenameFromContentDisposition(res.headers.get("Content-Disposition"))
  const filename = fromHeader || fallbackFilename

  const objectUrl = URL.createObjectURL(blob)
  try {
    const a = document.createElement("a")
    a.href = objectUrl
    a.download = filename
    a.rel = "noopener"
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
