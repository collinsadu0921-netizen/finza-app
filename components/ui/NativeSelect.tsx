"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

const sizeClasses = {
  sm: "h-8 px-2.5 pr-8 text-xs",
  md: "h-9 px-3 pr-9 text-sm",
  lg: "h-10 px-3.5 pr-10 text-base",
}

export interface NativeSelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  /** Visual size (not the HTML `size` attribute). */
  size?: "sm" | "md" | "lg"
  /** Classes for the outer wrapper (e.g. `w-auto shrink-0` for toolbar filters). */
  wrapperClassName?: string
}

/**
 * Styled native &lt;select&gt; with chevron, focus ring, and dark mode.
 * Use across the service workspace (and elsewhere) for consistent dropdown UI.
 */
export function NativeSelect({
  className,
  wrapperClassName,
  size = "md",
  disabled,
  children,
  ...props
}: NativeSelectProps) {
  return (
    <div
      className={cn(
        "relative min-w-0 w-full max-w-full",
        disabled && "opacity-60",
        wrapperClassName
      )}
    >
      <select
        className={cn(
          "w-full cursor-pointer appearance-none rounded-lg border border-slate-200 bg-white text-slate-900 shadow-sm transition-colors",
          "dark:border-slate-600 dark:bg-slate-800 dark:text-white",
          "hover:border-slate-300 dark:hover:border-slate-500",
          "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:border-blue-400 dark:focus:ring-blue-400/30",
          "disabled:cursor-not-allowed disabled:bg-slate-50 dark:disabled:bg-slate-900/50",
          sizeClasses[size],
          className
        )}
        disabled={disabled}
        {...props}
      >
        {children}
      </select>
      <span
        className="pointer-events-none absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-400 dark:text-slate-500"
        aria-hidden
      >
        <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </span>
    </div>
  )
}
