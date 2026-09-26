"use client"

import { useEffect, useState } from "react"
import { extractReceiptInBrowser } from "@/lib/ocr/extractReceiptInBrowser"
import { scanErrorMessage } from "@/lib/ocr/useReceiptScanner"

export default function ReceiptOcrBench() {
  const [status, setStatus] = useState("idle")
  const [output, setOutput] = useState("")

  useEffect(() => {
    setStatus("ready")
  }, [])

  return (
    <main style={{ fontFamily: "sans-serif", padding: 24, maxWidth: 720 }}>
      <h1>Receipt OCR bench</h1>
      <p id="ocr-status">{status}</p>
      <input
        id="ocr-file"
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          setStatus("starting")
          setOutput("")
          const started = performance.now()
          void extractReceiptInBrowser(file, { businessCurrency: "GHS", onPhase: setStatus })
            .then((result) => {
              setStatus("done")
              setOutput(
                JSON.stringify(
                  {
                    ms: Math.round(performance.now() - started),
                    supplier: result.suggestions.supplier_name ?? null,
                    date: result.suggestions.document_date ?? null,
                    total: result.suggestions.total ?? null,
                    currency: result.suggestions.currency_code ?? null,
                    confidence: result.confidence,
                    lineCount: result.lineCount,
                    warnings: result.warnings ?? [],
                    metrics: result.metrics ?? null,
                  },
                  null,
                  2
                )
              )
            })
            .catch((error: unknown) => {
              setStatus("failed")
              const message = error instanceof Error ? error.message : String(error)
              const stack = error instanceof Error ? error.stack : ""
              setOutput(`${scanErrorMessage(error)}\n\n${message}\n${stack ?? ""}`)
            })
        }}
      />
      <pre id="ocr-output">{output}</pre>
    </main>
  )
}
