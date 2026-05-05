"use client"

import { useEffect } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"

export default function LegacyCustomerStatementPage() {
  const params = useParams()
  const router = useRouter()
  const customerId = params.id as string
  const target = `/service/customers/${encodeURIComponent(customerId)}/statement`

  useEffect(() => {
    router.replace(target)
  }, [router, target])

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-xl border border-slate-200 bg-white p-6 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Statement moved</h1>
        <p className="text-sm text-slate-600 mt-2">
          Redirecting to the Service customer statement page.
        </p>
        <Link href={target} className="inline-flex mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Open statement
        </Link>
      </div>
    </div>
  )
}

