"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import RetailCameraBarcodeModal from "@/components/retail/RetailCameraBarcodeModal"
import { cn } from "@/lib/utils"

export type RetailBarcodeFieldWithCameraProps = {
  value: string
  onChange: (next: string) => void
  inputClassName: string
  placeholder?: string
  disabled?: boolean
  inputId?: string
  name?: string
  autoComplete?: string
  /**
   * Before replacing a non-empty value with a different scanned value.
   * Return false to keep the field unchanged (scanner still closes).
   */
  confirmReplace?: (previous: string, scanned: string) => boolean | Promise<boolean>
  scanButtonLabel?: string
  modalTitle?: string
  /** Optional class for the scan button (parent can match modal vs backoffice styles). */
  scanButtonClassName?: string
}

async function defaultConfirmReplace(previous: string, scanned: string): Promise<boolean> {
  const p = previous.trim()
  const s = scanned.trim()
  if (!p || p === s) return true
  if (typeof window === "undefined") return false
  return window.confirm(`Replace current barcode "${p}" with "${s}"?`)
}

const defaultScanButtonClass =
  "inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"

export default function RetailBarcodeFieldWithCamera({
  value,
  onChange,
  inputClassName,
  placeholder,
  disabled,
  inputId,
  name,
  autoComplete = "off",
  confirmReplace = defaultConfirmReplace,
  scanButtonLabel = "Scan barcode",
  modalTitle = "Scan barcode",
  scanButtonClassName = defaultScanButtonClass,
}: RetailBarcodeFieldWithCameraProps) {
  const [cameraOpen, setCameraOpen] = useState(false)
  const [highlight, setHighlight] = useState(false)
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
    }
  }, [])

  const applyScanned = useCallback(
    async (code: string) => {
      const next = code.trim()
      if (!next) return
      const ok = await confirmReplace(value, next)
      if (!ok) return
      onChange(next)
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
      setHighlight(true)
      highlightTimer.current = setTimeout(() => setHighlight(false), 1600)
    },
    [value, onChange, confirmReplace]
  )

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <input
          id={inputId}
          name={name}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          autoComplete={autoComplete}
          className={cn(inputClassName, "min-w-0 flex-1", highlight && "ring-2 ring-blue-400 ring-offset-1 ring-offset-white dark:ring-offset-slate-950")}
          placeholder={placeholder}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setCameraOpen(true)}
          className={cn(scanButtonClassName, "min-h-[42px] touch-manipulation")}
        >
          {scanButtonLabel}
        </button>
      </div>
      <RetailCameraBarcodeModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCode={applyScanned}
        title={modalTitle}
      />
    </>
  )
}
