import React from "react"
import { cn } from "@/lib/utils"

interface MoneyProps {
    amount: number | string
    currency?: string
    type?: "in" | "out" | "neutral" | "error"
    className?: string
    showSign?: boolean
}

export function Money({
    amount,
    currency = "GHS",
    type = "neutral",
    className,
    showSign = false
}: MoneyProps) {
    const numAmount = Number(amount) || 0
    const isNegative = numAmount < 0
    const absAmount = Math.abs(numAmount)

    // Determine color class based on type
    const colorClass = {
        in: "text-emerald-600 dark:text-emerald-400", // Money in 
        out: "text-slate-600 dark:text-slate-400",  // Money out (neutral)
        error: "text-rose-600 dark:text-rose-400", // Errors/Overdue
        neutral: "text-slate-900 dark:text-gray-100",
    }[type]

    const formattedAmount = absAmount.toLocaleString('en-GH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })

    // Handle signs visually only
    const sign = showSign && type === 'in' ? '+' : (isNegative ? '-' : '')

    return (
        <span className={cn(
            "font-mono tabular-nums tracking-tight inline-flex items-baseline",
            colorClass,
            className
        )}>
            {sign}
            <span className="text-[0.85em] opacity-70 mr-1 select-none font-sans font-medium">{currency}</span>
            {formattedAmount}
        </span>
    )
}
