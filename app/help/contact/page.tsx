"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import ContactSupportForm from "@/components/support/ContactSupportForm"
import { getSelectedBusinessId } from "@/lib/business"
import { supabase } from "@/lib/supabaseClient"

type RecentRequest = {
  id: string
  category: string
  subject: string | null
  urgency: string
  status: string
  created_at: string
}

export default function HelpContactPage() {
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [recent, setRecent] = useState<RecentRequest[]>([])
  const [loadingRecent, setLoadingRecent] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || cancelled) {
        setLoadingRecent(false)
        return
      }
      const bid = getSelectedBusinessId()
      setBusinessId(bid)
      if (!bid) {
        setLoadingRecent(false)
        return
      }
      try {
        const res = await fetch(
          `/api/support/requests?business_id=${encodeURIComponent(bid)}&limit=5`
        )
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) setRecent(data.requests ?? [])
        }
      } finally {
        if (!cancelled) setLoadingRecent(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:py-10">
        <Link href="/help" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
          ← Help & Support
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-slate-900 dark:text-white">Contact Finza Support</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Describe your issue and we will follow up by email. For billing emergencies, choose urgent.
        </p>

        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <ContactSupportForm businessId={businessId} />
        </div>

        {!loadingRecent && recent.length > 0 ? (
          <section className="mt-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Your recent requests
            </h2>
            <ul className="mt-3 space-y-2">
              {recent.map((req) => (
                <li
                  key={req.id}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="font-medium text-slate-800 dark:text-slate-100">
                    {req.subject || req.category}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {req.category} · {req.status} · {new Date(req.created_at).toLocaleDateString()}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  )
}
