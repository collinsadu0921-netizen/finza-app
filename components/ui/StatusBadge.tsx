import React from "react"
import { cn } from "@/lib/utils"

export type StatusType =
    | "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "cancelled" | "void"
    | "open" | "soft_closed" | "locked"

interface StatusBadgeProps {
    status: string
    className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
    const normalizedStatus = status.toLowerCase().replace(/ /g, "_") as StatusType

    const styles: Record<string, string> = {
        // Invoice Statuses
        draft: "bg-gray-100 text-gray-600 border border-gray-200", // Neutral Gray (Pending)
        sent: "bg-blue-50 text-blue-700 border border-blue-200",   // Blue (Active)
        partially_paid: "bg-amber-50 text-amber-700 border border-amber-200", // Amber (Warning/Progress)
        paid: "bg-emerald-50 text-emerald-700 border border-emerald-200", // Emerald (Success)
        overdue: "bg-rose-50 text-rose-700 border border-rose-200", // Rose (Critical)
        cancelled: "bg-slate-100 text-slate-500 border border-slate-200 line-through decoration-slate-400", // Slate (History)
        void: "bg-slate-100 text-slate-500 border border-slate-200 line-through decoration-slate-400",

        // VAT Return Statuses
        submitted: "bg-blue-50 text-blue-700 border border-blue-200",

        // Period Statuses
        open: "bg-emerald-50 text-emerald-700 border border-emerald-200",
        soft_closed: "bg-amber-50 text-amber-700 border border-amber-200",
        locked: "bg-slate-100 text-slate-800 border border-slate-300",
    }

    // Fallback for unknown statuses
    const baseStyle = styles[normalizedStatus] || "bg-gray-100 text-gray-800 border border-gray-200"

    const label = normalizedStatus.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")

    return (
        <span className={cn(
            "px-2.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wide tabular-nums select-none",
            baseStyle,
            className
        )}>
            {label}
        </span>
    )
}
