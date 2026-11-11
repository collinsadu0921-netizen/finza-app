"use client"

import { useEffect, useRef, type KeyboardEvent, type TextareaHTMLAttributes } from "react"
import { InlineFormattedText } from "@/components/proposals/InlineFormattedText"
import { toggleBoldSelection } from "@/lib/proposals/inlineFormatting"

type BoldTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string
  onValueChange: (value: string) => void
  /** Bullet lists: apply bold to each selected line instead of across lines. */
  perLine?: boolean
}

export function BoldTextarea({
  value,
  onValueChange,
  perLine = false,
  className,
  onKeyDown,
  ...rest
}: BoldTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const pendingSelection = useRef<{ start: number; end: number } | null>(null)

  useEffect(() => {
    const element = ref.current
    const pending = pendingSelection.current
    if (!element || !pending) return
    element.focus()
    element.setSelectionRange(pending.start, pending.end)
    pendingSelection.current = null
  }, [value])

  function applyBold() {
    const element = ref.current
    if (!element) return
    const result = toggleBoldSelection(value, element.selectionStart, element.selectionEnd, {
      perLine,
    })
    pendingSelection.current = { start: result.selectionStart, end: result.selectionEnd }
    onValueChange(result.value)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
      event.preventDefault()
      applyBold()
    }
    onKeyDown?.(event)
  }

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={applyBold}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          aria-label="Bold selected text"
          title="Bold selected text (Ctrl+B)"
        >
          <span className="font-serif text-sm leading-none">B</span>
          Bold
        </button>
        <span className="text-[11px] text-slate-400">Select text, then click Bold or press Ctrl+B</span>
      </div>
      <textarea
        {...rest}
        ref={ref}
        className={className}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {value.includes("**") ? (
        <div className="mt-1.5 whitespace-pre-wrap rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs leading-relaxed text-slate-700">
          <span className="mr-1.5 font-semibold uppercase tracking-wide text-slate-400">Preview</span>
          <InlineFormattedText text={value} />
        </div>
      ) : null}
    </div>
  )
}
