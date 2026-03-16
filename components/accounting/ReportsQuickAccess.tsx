"use client"

import Link from "next/link"
import { buildAccountingRoute } from "@/lib/accounting/routes"

const REPORTS = [
  { label: "Trial Balance", path: "/accounting/reports/trial-balance" },
  { label: "Profit & Loss", path: "/accounting/reports/profit-and-loss" },
  { label: "Balance Sheet", path: "/accounting/reports/balance-sheet" },
  { label: "General Ledger", path: "/accounting/ledger" },
  { label: "Reconciliation", path: "/accounting/reconciliation" },
] as const

export interface ReportsQuickAccessProps {
  businessId: string | null
}

export default function ReportsQuickAccess({ businessId }: ReportsQuickAccessProps) {
  if (!businessId) return null

  return (
    <section className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 p-4">
      <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
        Reports
      </h2>
      <div className="flex flex-wrap gap-2">
        {REPORTS.map(({ label, path }) => (
          <Link
            key={path}
            href={buildAccountingRoute(path, businessId)}
            className="px-3 py-1.5 text-sm font-medium rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            {label}
          </Link>
        ))}
      </div>
    </section>
  )
}
