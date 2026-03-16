"use client"

import { useEffect, useRef, useState } from "react"

type BarcodeScannerProps = {
  onScan: (barcode: string) => void
  enabled?: boolean
}

export default function BarcodeScanner({ onScan, enabled = true }: BarcodeScannerProps) {
  const [barcodeBuffer, setBarcodeBuffer] = useState("")
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!enabled) return

    // Focus the hidden input on mount
    if (inputRef.current) {
      inputRef.current.focus()
    }

    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore if user is typing in a visible input/textarea
      const target = e.target as HTMLElement
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        // Only process if it's our hidden input
        if (target !== inputRef.current) {
          return
        }
      }

      // Clear timeout if it exists
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      // Handle Enter key (end of scan)
      if (e.key === "Enter") {
        e.preventDefault()
        if (barcodeBuffer.trim().length > 0) {
          onScan(barcodeBuffer.trim())
          setBarcodeBuffer("")
        }
        return
      }

      // Handle regular characters
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setBarcodeBuffer((prev) => prev + e.key)

        // Set timeout to auto-submit if no input for 100ms (typical barcode scanner behavior)
        timeoutRef.current = setTimeout(() => {
          if (barcodeBuffer.trim().length > 0) {
            onScan(barcodeBuffer.trim())
            setBarcodeBuffer("")
          }
        }, 100)
      }
    }

    // Handle input events on the hidden input
    const handleInput = (e: Event) => {
      const target = e.target as HTMLInputElement
      if (target.value && target.value.length > 0) {
        setBarcodeBuffer(target.value)
      }
    }

    window.addEventListener("keydown", handleKeyPress)
    const input = inputRef.current
    if (input) {
      input.addEventListener("input", handleInput)
    }

    return () => {
      window.removeEventListener("keydown", handleKeyPress)
      if (input) {
        input.removeEventListener("input", handleInput)
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [enabled, barcodeBuffer, onScan])

  // Auto-focus when enabled changes
  useEffect(() => {
    if (enabled && inputRef.current) {
      inputRef.current.focus()
    }
  }, [enabled])

  return (
    <input
      ref={inputRef}
      type="text"
      autoFocus
      value={barcodeBuffer}
      onChange={(e) => setBarcodeBuffer(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          if (barcodeBuffer.trim().length > 0) {
            onScan(barcodeBuffer.trim())
            setBarcodeBuffer("")
          }
        }
      }}
      className="absolute opacity-0 pointer-events-none w-0 h-0"
      style={{ position: "fixed", left: "-9999px" }}
      tabIndex={-1}
    />
  )
}







