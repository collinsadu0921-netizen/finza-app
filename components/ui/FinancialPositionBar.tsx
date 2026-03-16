import React from "react"
import { Money } from "./Money"
import { cn } from "@/lib/utils"

interface FinancialPositionBarProps {
    currency: string
    total: number
    paid: number
    credits: number
    balance: number
    className?: string
    /** Override balance amount typography (e.g. for invoice view to match system totals). */
    balanceClassName?: string
}

export function FinancialPositionBar({
    currency,
    total,
    paid,
    credits,
    balance,
    className,
    balanceClassName
}: FinancialPositionBarProps) {
    return (
        <div className={cn(
            "flex flex-col sm:flex-row items-stretch sm:items-center gap-4 sm:gap-8 p-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700",
            className
        )}>
            {/* Total Section */}
            <div className="flex flex-col">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Total</span>
                <Money
                    amount={total}
                    currency={currency}
                    type="neutral"
                    className="text-2xl font-bold"
                />
            </div>

            {/* Operator - Mobile Hidden */}
            <div className="hidden sm:block text-slate-300 text-2xl font-light select-none">−</div>

            {/* Paid Section */}
            <div className="flex flex-col">
                <span className="text-[10px] uppercase font-bold text-emerald-600 tracking-wider mb-1">Paid</span>
                <Money
                    amount={paid}
                    currency={currency}
                    type="in"
                    className="text-2xl font-bold"
                    showSign
                />
            </div>

            {credits > 0 && (
                <>
                    <div className="hidden sm:block text-slate-300 text-2xl font-light select-none">−</div>
                    {/* Credits Section */}
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase font-bold text-amber-600 tracking-wider mb-1">Credits</span>
                        <Money
                            amount={credits}
                            currency={currency}
                            type="out"
                            className="text-2xl font-bold text-amber-600"
                            showSign
                        />
                    </div>
                </>
            )}

            {/* Equals Operator - Mobile Hidden */}
            <div className="hidden sm:block text-slate-300 text-2xl font-light select-none">=</div>

            {/* Due Section (Result) */}
            <div className="flex flex-col sm:border-l-2 border-slate-100 dark:border-slate-700 sm:pl-8 ml-auto sm:ml-0 pt-4 sm:pt-0 border-t sm:border-t-0 w-full sm:w-auto mt-2 sm:mt-0">
                <span className={cn(
                    "text-[10px] uppercase font-bold tracking-wider mb-1",
                    balance > 0.01 ? "text-rose-600" : "text-emerald-600"
                )}>
                    {balance > 0.01 ? "Amount Due" : "Settled"}
                </span>
                <Money
                    amount={balance}
                    currency={currency}
                    type={balance > 0.01 ? "error" : "in"}
                    className={balanceClassName ?? "text-3xl font-black tabular-nums tracking-tight"}
                />
            </div>
        </div>
    )
}
