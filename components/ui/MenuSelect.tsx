"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

export type MenuSelectOption = { value: string; label: string }

const triggerSizes = {
  sm: "h-8 pl-2.5 pr-8 text-xs",
  md: "h-9 pl-3 pr-9 text-sm",
  lg: "h-10 pl-3.5 pr-10 text-base min-h-[2.5rem]",
}

function getScrollableAncestors(el: HTMLElement | null): HTMLElement[] {
  const out: HTMLElement[] = []
  let cur: HTMLElement | null = el?.parentElement ?? null
  while (cur) {
    const style = window.getComputedStyle(cur)
    const ox = style.overflowX
    const oy = style.overflowY
    if (/(auto|scroll|overlay)/.test(ox) || /(auto|scroll|overlay)/.test(oy)) {
      out.push(cur)
    }
    cur = cur.parentElement
  }
  out.push(document.documentElement)
  return out
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
  /** Dropdown panel (portal — fixed layer) */
  contentClassName?: string
  id?: string
}

/**
 * Custom dropdown for filters and toolbars — rounded panel, shadow, keyboard-friendly.
 * Prefer over native &lt;select&gt; when the OS menu looks out of place.
 * The list renders in a document portal so parents with `overflow: auto` cannot clip it.
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
  const panelRef = React.useRef<HTMLDivElement>(null)
  const listId = React.useId()
  const [panelBox, setPanelBox] = React.useState<{ top: number; left: number; width: number } | null>(null)

  const selected = options.find((o) => o.value === value)
  const label = selected?.label ?? placeholder

  const measurePanel = React.useCallback(() => {
    const el = rootRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPanelBox({ top: r.bottom + 6, left: r.left, width: r.width })
  }, [])

  React.useLayoutEffect(() => {
    if (!open) {
      setPanelBox(null)
      return
    }
    measurePanel()
    const scrollOpts: AddEventListenerOptions = { passive: true, capture: true }
    const scrollRoots = getScrollableAncestors(rootRef.current)
    for (const el of scrollRoots) {
      el.addEventListener("scroll", measurePanel, scrollOpts)
    }
    window.addEventListener("resize", measurePanel, { passive: true })
    return () => {
      for (const el of scrollRoots) {
        el.removeEventListener("scroll", measurePanel, scrollOpts)
      }
      window.removeEventListener("resize", measurePanel)
    }
  }, [open, measurePanel])

  React.useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (rootRef.current?.contains(t)) return
      if (panelRef.current?.contains(t)) return
      setOpen(false)
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

  const panel =
    open && panelBox ? (
      <div
        ref={panelRef}
        id={listId}
        role="listbox"
        style={{
          position: "fixed",
          top: panelBox.top,
          left: panelBox.left,
          width: panelBox.width,
          zIndex: 9999,
        }}
        className={cn(
          "max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-slate-200/90 bg-white py-1 shadow-lg ring-1 ring-slate-900/5 dark:border-slate-600 dark:bg-slate-800 dark:ring-white/10",
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
    ) : null

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

      {typeof document !== "undefined" && panel ? createPortal(panel, document.body) : null}
    </div>
  )
}
