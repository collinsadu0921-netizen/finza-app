"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export type MenuSelectOption = { value: string; label: string }

const triggerSizes = {
  sm: "h-8 pl-2.5 pr-8 text-xs",
  md: "h-9 pl-3 pr-9 text-sm",
  lg: "h-10 pl-3.5 pr-10 text-base min-h-[2.5rem]",
}

export interface MenuSelectProps {
  value: string
  onValueChange: (value: string) => void
  options: MenuSelectOption[]
  /** Shown when value is missing from options */
  placeholder?: string
  size?: "sm" | "md" | "lg"
  disabled?: boolean
  className?: string
  /** Outer wrapper (width, flex) */
  wrapperClassName?: string
  /** Dropdown panel */
  contentClassName?: string
  id?: string
}

/**
 * Custom dropdown for filters and toolbars — rounded panel, shadow, keyboard-friendly.
 * Prefer over native &lt;select&gt; when the OS menu looks out of place.
 */
export function MenuSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  size = "md",
  disabled,
  className,
  wrapperClassName,
  contentClassName,
  id,
}: MenuSelectProps) {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const listId = React.useId()

  const selected = options.find((o) => o.value === value)
  const label = selected?.label ?? placeholder

  React.useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    if (open) {
      document.addEventListener("mousedown", onDoc)
      return () => document.removeEventListener("mousedown", onDoc)
    }
  }, [open])

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    if (open) {
      document.addEventListener("keydown", onKey)
      return () => document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div
      ref={rootRef}
      className={cn("relative min-w-0 w-full max-w-full", disabled && "pointer-events-none opacity-60", wrapperClassName)}
    >
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative w-full cursor-pointer rounded-lg border border-slate-200 bg-white text-left font-medium text-slate-900 shadow-sm transition-colors",
          "hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:hover:border-slate-500",
          "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:border-blue-400 dark:focus:ring-blue-400/30",
          triggerSizes[size],
          className
        )}
      >
        <span className="block truncate">{label}</span>
        <span
          className="pointer-events-none absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-400 dark:text-slate-500"
          aria-hidden
        >
          <svg
            className={cn("h-4 w-4 shrink-0 transition-transform duration-200", open && "rotate-180")}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          className={cn(
            "absolute left-0 right-0 top-full z-[100] mt-1.5 max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-slate-200/90 bg-white py-1 shadow-lg ring-1 ring-slate-900/5 dark:border-slate-600 dark:bg-slate-800 dark:ring-white/10",
            contentClassName
          )}
        >
          {options.map((opt) => {
            const isActive = opt.value === value
            return (
              <button
                key={opt.value === "" ? "__empty__" : opt.value}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onValueChange(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center px-3 py-2.5 text-left text-sm transition-colors",
                  isActive
                    ? "bg-blue-50 font-medium text-blue-900 dark:bg-blue-950/60 dark:text-blue-100"
                    : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/90"
                )}
              >
                <span className="min-w-0 truncate">{opt.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
