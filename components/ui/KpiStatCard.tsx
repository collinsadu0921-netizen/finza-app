"use client"

import type { ButtonHTMLAttributes, ReactNode } from "react"
import { cn } from "@/lib/utils"

export type KpiStatCardValueVariant = "number" | "currency"

const valueNumberClass =
  "font-bold tabular-nums leading-tight text-slate-900 text-xl sm:text-2xl [overflow-wrap:anywhere]"

const valueCurrencyClass =
  "font-bold tabular-nums leading-tight text-slate-900 text-base sm:text-lg md:text-xl lg:text-2xl [overflow-wrap:anywhere]"

export type KpiStatCardProps = {
  icon: ReactNode
  /** Background (and typically icon tint) for the fixed-size icon tile, e.g. `bg-blue-100` */
  iconWrapperClassName: string
  label: string
  value: ReactNode
  valueVariant?: KpiStatCardValueVariant
  valueClassName?: string
  labelClassName?: string
  hint?: ReactNode
  /** `row`: icon + value stack (Materials pattern). `header`: label row + icon, then value (Invoices pattern). */
  layout?: "row" | "header"
  className?: string
  bodyClassName?: string
  onClick?: () => void
  /** Use a button root (e.g. clickable filter card). */
  as?: "div" | "button"
  buttonProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children" | "type">
}

/**
 * Shared KPI / stat tile: fixed icon tile (`shrink-0`), flexible text (`min-w-0`),
 * responsive value sizing — use `valueVariant="currency"` for money amounts.
 */
export function KpiStatCard({
  icon,
  iconWrapperClassName,
  label,
  value,
  valueVariant = "number",
  valueClassName,
  labelClassName,
  hint,
  layout = "row",
  className,
  bodyClassName,
  onClick,
  as = "div",
  buttonProps,
}: KpiStatCardProps) {
  const baseCard = cn(
    "min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm",
    onClick && "cursor-pointer transition-colors hover:border-slate-300 hover:shadow",
    className
  )

  const valueClasses = valueVariant === "currency" ? valueCurrencyClass : valueNumberClass

  if (layout === "header") {
    const inner = (
      <>
        <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
          <span
            className={cn(
              "min-w-0 flex-1 text-xs font-bold uppercase tracking-wider text-slate-400 leading-tight",
              labelClassName
            )}
          >
            {label}
          </span>
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              iconWrapperClassName
            )}
          >
            {icon}
          </div>
        </div>
        <p className={cn(valueClasses, valueClassName)}>{value}</p>
        {hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}
      </>
    )

    if (as === "button") {
      return (
        <button type="button" className={cn(baseCard, "w-full text-left")} onClick={onClick} {...buttonProps}>
          {inner}
        </button>
      )
    }
    return (
      <div className={baseCard} onClick={onClick} role={onClick ? "button" : undefined}>
        {inner}
      </div>
    )
  }

  const rowInner = (
    <div className={cn("flex items-center gap-4", bodyClassName)}>
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          iconWrapperClassName
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn(valueClasses, valueClassName)}>{value}</p>
        <p className={cn("mt-0.5 text-xs uppercase tracking-wide text-slate-500", labelClassName)}>{label}</p>
        {hint ? <div className="mt-1">{hint}</div> : null}
      </div>
    </div>
  )

  if (as === "button") {
    return (
      <button type="button" className={cn(baseCard, "w-full text-left")} onClick={onClick} {...buttonProps}>
        {rowInner}
      </button>
    )
  }

  return (
    <div className={baseCard} onClick={onClick} role={onClick ? "button" : undefined}>
      {rowInner}
    </div>
  )
}
