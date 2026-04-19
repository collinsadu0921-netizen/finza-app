"use client"

import type { ReactNode } from "react"
import { NativeSelect, type NativeSelectProps } from "@/components/ui/NativeSelect"
import { MenuSelect, type MenuSelectProps } from "@/components/ui/MenuSelect"
import { cn } from "@/lib/utils"

export type { MenuSelectOption } from "@/components/ui/MenuSelect"

/** Page chrome for retail catalog / inventory back-office (aligned with {@link retailSettingsShell} tokens). */
export function RetailBackofficeShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "min-h-[calc(100vh-4rem)] bg-gray-50 text-gray-900 antialiased dark:bg-gray-950 dark:text-gray-100",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function RetailBackofficeMain({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8", className)}>{children}</div>
}

export function RetailBackofficePageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string
  description?: string
  actions?: ReactNode
  eyebrow?: string
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-gray-200 pb-6 dark:border-gray-800 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{eyebrow}</p>
        ) : null}
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{title}</h1>
        {description ? <p className="max-w-2xl text-sm leading-relaxed text-gray-600 dark:text-gray-400">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function RetailBackofficeCard({
  children,
  className,
  padding = "p-5 sm:p-6",
}: {
  children: ReactNode
  className?: string
  padding?: string
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900",
        padding,
        className,
      )}
    >
      {children}
    </div>
  )
}

export function RetailBackofficeCardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("text-base font-semibold tracking-tight text-gray-900 dark:text-white", className)}>{children}</h2>
}

export function RetailBackofficeSubtle({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs leading-relaxed text-gray-500 dark:text-gray-400", className)}>{children}</p>
}

export const retailFieldClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 transition focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-950 dark:text-white dark:placeholder:text-gray-500"

export const retailLabelClass = "mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400"

export function RetailBackofficeButton({
  variant = "primary",
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40 dark:focus-visible:ring-offset-gray-950"
  const variants: Record<NonNullable<typeof variant>, string> = {
    primary:
      "bg-blue-600 text-white shadow-sm hover:bg-blue-700 focus-visible:ring-blue-500",
    secondary:
      "border border-gray-300 bg-white text-gray-800 shadow-sm hover:bg-gray-50 focus-visible:ring-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700",
    ghost: "text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-gray-400 dark:text-gray-400 dark:hover:bg-gray-800",
    danger:
      "border border-red-200 bg-white text-red-700 shadow-sm hover:bg-red-50 focus-visible:ring-red-400 dark:border-red-900/50 dark:bg-gray-900 dark:text-red-300",
  }
  return (
    <button type="button" className={cn(base, variants[variant], className)} {...props}>
      {children}
    </button>
  )
}

export function RetailBackofficeBackLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-blue-600 transition hover:underline dark:text-blue-400"
    >
      <span className="text-blue-500 dark:text-blue-500" aria-hidden>
        ←
      </span>
      {children}
    </button>
  )
}

export function RetailBackofficeBadge({
  tone,
  children,
  className,
}: {
  tone: "neutral" | "success" | "warning" | "danger" | "info"
  children: ReactNode
  className?: string
}) {
  const map: Record<typeof tone, string> = {
    neutral: "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100",
    warning: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
    danger: "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100",
    info: "border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-100",
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        map[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function RetailBackofficeEmpty({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <RetailBackofficeCard className="text-center">
      <div className="mx-auto max-w-md py-12">
        <p className="text-base font-semibold text-gray-900 dark:text-white">{title}</p>
        {description ? <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{description}</p> : null}
        {action ? <div className="mt-8 flex justify-center">{action}</div> : null}
      </div>
    </RetailBackofficeCard>
  )
}

export function RetailBackofficeSectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-3 border-b border-gray-100 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
      {children}
    </h3>
  )
}

/** @deprecated Prefer {@link RetailMenuSelect} or {@link RetailNativeSelect}. */
export const retailSelectClass = retailFieldClass

/**
 * Retail back-office: **custom** dropdown list (rounded panel, shadow, themeable) — not the OS native menu.
 * Prefer this for filters and forms so the open state matches the product UI.
 */
export function RetailMenuSelect({ className, size = "lg", ...props }: MenuSelectProps) {
  return (
    <MenuSelect
      size={size}
      className={cn(
        size !== "sm" && "min-h-[44px]",
        "border-2 border-slate-300 bg-slate-50/50 font-semibold text-slate-900 shadow-inner",
        "hover:border-slate-400 focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-500/20",
        "dark:border-slate-600 dark:bg-slate-900 dark:text-white",
        className,
      )}
      {...props}
    />
  )
}

/**
 * Styled **native** `<select>` (chevron on the closed control only; the open list is still OS-rendered).
 * Use only when a native picker is required; otherwise prefer {@link RetailMenuSelect}.
 */
export function RetailNativeSelect({ className, size = "lg", ...props }: NativeSelectProps) {
  return (
    <NativeSelect
      size={size}
      className={cn(
        "min-h-[44px] border-2 border-slate-300 bg-slate-50/50 font-semibold text-slate-900 shadow-inner placeholder:text-slate-400",
        "hover:border-slate-400 focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-500/20",
        "dark:border-slate-600 dark:bg-slate-900 dark:text-white",
        className,
      )}
      {...props}
    />
  )
}

/**
 * Lightweight loading placeholder for list/report pages (not full-screen spinners).
 */
export function RetailBackofficeSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="animate-pulse divide-y divide-gray-100 dark:divide-gray-800">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4 sm:px-6">
            <div className="h-4 max-w-md flex-1 rounded-md bg-gray-200/80 dark:bg-gray-700" />
            <div className="h-4 w-20 shrink-0 rounded-md bg-gray-200/80 dark:bg-gray-700" />
            <div className="h-4 w-16 shrink-0 rounded-md bg-gray-200/70 dark:bg-gray-700" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function RetailBackofficeAlert({
  tone,
  children,
  className,
}: {
  tone: "error" | "warning" | "info" | "success"
  children: ReactNode
  className?: string
}) {
  const map: Record<typeof tone, string> = {
    error: "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-100",
    warning: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-100",
    info: "border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900/40 dark:bg-blue-950/25 dark:text-blue-100",
    success: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100",
  }
  return (
    <div role="alert" className={cn("rounded-lg border px-4 py-3 text-sm leading-relaxed", map[tone], className)}>
      {children}
    </div>
  )
}
