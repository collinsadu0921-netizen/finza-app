"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"

export default function ServiceAccountingPage() {
  const [loading, setLoading] = useState(true)
  const [business, setBusiness] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setLoading(false)
          return
        }
        const b = await getCurrentBusiness(supabase, user.id)
        if (!cancelled && b) setBusiness(b)
      } catch (_) {
        // ignore
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      
        <div className="p-6">
          <p>Loading...</p>
        </div>
      
    )
  }

  return (
    
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Accounting</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Record adjustments and view your books.
        </p>

        <section className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Quick Actions</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              href="/service/accounting/adjustment"
              className="flex flex-col p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:border-blue-200 dark:hover:border-blue-800 transition-colors"
            >
              <span className="font-semibold text-gray-900 dark:text-gray-100">Owner Withdrawal</span>
              <span className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Record money you take out of the business
              </span>
            </Link>
            <Link
              href="/service/accounting/contribution"
              className="flex flex-col p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:border-blue-200 dark:hover:border-blue-800 transition-colors"
            >
              <span className="font-semibold text-gray-900 dark:text-gray-100">Record Owner Contribution</span>
              <span className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Record money you invest into the business.
              </span>
            </Link>
          </div>
        </section>
      </div>
    
  )
}
