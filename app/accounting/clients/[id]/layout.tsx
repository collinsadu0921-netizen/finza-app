"use client"

import { useParams, usePathname } from "next/navigation"
import Link from "next/link"

const CLIENT_TABS = [
  { label: "Overview", segment: "overview" },
  { label: "Tasks", segment: "tasks" },
  { label: "Requests", segment: "requests" },
  { label: "Filings", segment: "filings" },
  { label: "VAT", segment: "vat" },
  { label: "Periods", segment: "periods" },
  { label: "Adjustments", segment: "adjustments" },
  { label: "Documents", segment: "documents" },
  { label: "Notes", segment: "notes" },
]

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const params = useParams()
  const pathname = usePathname()
  const businessId = params.id as string

  // Match the final path segment exactly — avoids false positives on businessId containing a segment name.
  const activeSegment = pathname?.split("/").pop() ?? ""

  return (
    <>
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="pt-4 pb-0">
            <Link
              href="/accounting/clients"
              className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              ← Clients
            </Link>
          </div>
          <nav className="flex items-center gap-0 mt-3" aria-label="Client sections">
            {CLIENT_TABS.map((tab) => {
              const href = `/accounting/clients/${businessId}/${tab.segment}`
              const isActive = activeSegment === tab.segment
              return (
                <Link
                  key={tab.segment}
                  href={href}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                    isActive
                      ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                      : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600"
                  }`}
                >
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
      {children}
    </>
  )
}
