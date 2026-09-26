"use client"

import { useCallback, useEffect, useState } from "react"
import { extractReceiptInBrowser } from "@/lib/ocr/extractReceiptInBrowser"
import { getReceiptScannerPhase, subscribeReceiptScannerPhase } from "@/lib/ocr/paddleReceiptOcr.client"
import type { ReceiptOcrResult } from "@/lib/ocr/receiptParser"
import type { ReceiptOcrPhase } from "@/lib/ocr/types"
import { userMessageForScanCode } from "@/lib/ocr/userMessages"

export function useReceiptScanner() {
  const [phase, setPhase] = useState<ReceiptOcrPhase>(getReceiptScannerPhase())

  useEffect(() => subscribeReceiptScannerPhase(setPhase), [])

  const scan = useCallback(async (file: File, businessCurrency?: string) => {
    const result = await extractReceiptInBrowser(file, {
      businessCurrency,
      onPhase: setPhase,
    })
    return result
  }, [])

  return { phase, scan }
}

export function scanErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : undefined
  return userMessageForScanCode(code)
}

export function hasMeaningfulReceiptSuggestions(result: ReceiptOcrResult): boolean {
  const s = result.suggestions
  return Boolean(
    (s.supplier_name && s.supplier_name.trim()) ||
      s.document_date ||
      (typeof s.total === "number" && s.total > 0) ||
      (s.document_number && s.document_number.trim())
  )
}
