"use client"

import { useEffect, useRef } from "react"

type BarcodeScannerProps = {
  onScan: (barcode: string) => void
  enabled?: boolean
}

/**
 * Optional global keyboard-wedge listener (not mounted on Retail POS — the visible scan field is primary).
 * Uses a ref buffer so rapid scanner keys are not lost to stale React closures.
 *
 * Ignores key events when focus is already in a form field so typing in modals is not captured.
 */
export default function BarcodeScanner({ onScan, enabled = true }: BarcodeScannerProps) {
  const bufferRef = useRef("")
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled) return

    const flush = () => {
      const v = bufferRef.current.trim()
      bufferRef.current = ""
      if (v) onScan(v)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      const tag = target.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
        return
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }

      if (e.key === "Enter") {
        e.preventDefault()
        flush()
        return
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        bufferRef.current += e.key
        timeoutRef.current = setTimeout(() => {
          flush()
          timeoutRef.current = null
        }, 100)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [enabled, onScan])

  return null
}
