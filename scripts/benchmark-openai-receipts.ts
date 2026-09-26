/**
 * Manual real-receipt benchmark. Not part of CI.
 *
 *   npx tsx scripts/benchmark-openai-receipts.ts --dir path/to/receipts
 *
 * Requires OPENAI_API_KEY. Optional OPENAI_RECEIPT_MODEL (default gpt-6-luna).
 * Prints field values and token counts. Does not print file bytes.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { extractReceiptWithOpenAi } from "../lib/ocr/openaiReceiptExtract"

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
}

function argDir(): string {
  const index = process.argv.indexOf("--dir")
  const value = index >= 0 ? process.argv[index + 1] : ""
  if (!value) throw new Error("Pass --dir")
  return value
}

async function main() {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.log(JSON.stringify({ skipped: true, reason: "OPENAI_API_KEY is not set" }))
    return
  }
  const dir = argDir()
  const files = readdirSync(dir).filter((name) => MIME[path.extname(name).toLowerCase()])
  const rows = []
  for (const name of files) {
    const full = path.join(dir, name)
    const bytes = new Uint8Array(readFileSync(full))
    const started = Date.now()
    try {
      const result = await extractReceiptWithOpenAi({
        bytes,
        mime: MIME[path.extname(name).toLowerCase()],
        filename: name,
      })
      rows.push({
        file: name,
        bytes: statSync(full).size,
        ms: Date.now() - started,
        model: result.model,
        supplier: result.extraction.supplier_name,
        date: result.extraction.document_date,
        total: result.extraction.total_amount,
        currency: result.extraction.currency,
        warnings: result.extraction.warnings,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        requestId: result.requestId ?? null,
      })
    } catch (error) {
      rows.push({
        file: name,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : "failed",
        code: typeof error === "object" && error && "code" in error ? String(error.code) : null,
      })
    }
  }
  console.log(JSON.stringify({ model: process.env.OPENAI_RECEIPT_MODEL || "gpt-6-luna", count: rows.length, rows }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "benchmark failed")
  process.exit(1)
})
