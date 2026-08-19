"use client"

import Link from "next/link"
import { buildPracticeClientOverviewHref } from "@/lib/practice/practiceClientBooks"
import type { PracticeBooksAccessLevel } from "@/lib/practice/resolvePracticeClientBooksContext"

const ACCESS_LABEL: Record<PracticeBooksAccessLevel, string> = {
  read: "Read access",
  write: "Write access",
  approve: "Approve access",
}

type Props = {
  clientName: string
  businessId: string
  accessLevel: PracticeBooksAccessLevel
}

export default function PracticeClientBooksBar({
  clientName,
  businessId,
  accessLevel,
}: Props) {
  const backHref = buildPracticeClientOverviewHref(businessId)

  return (
    <div
      role="region"
      aria-label="Practice client books context"
      className="mb-4 rounded-lg border border-slate-200 bg-white px-3 py-2.5 sm:px-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Finza Practice
          </p>
          <p className="truncate text-sm font-semibold text-slate-900">
            {clientName}
          </p>
          <p className="text-xs text-slate-600">
            Viewing client books · {ACCESS_LABEL[accessLevel]}
          </p>
        </div>
        <Link
          href={backHref}
          className="inline-flex shrink-0 items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Back to Practice
        </Link>
      </div>
    </div>
  )
}
