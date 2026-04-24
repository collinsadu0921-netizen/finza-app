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
            <Link
              href="/service/accounting/loan"
              className="flex flex-col p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:border-blue-200 dark:hover:border-blue-800 transition-colors"
            >
              <span className="font-semibold text-gray-900 dark:text-gray-100">Record Loan</span>
              <span className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Record a loan drawdown or principal repayment.
              </span>
            </Link>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Tax Compliance</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Manage withholding tax deductions and corporate income tax provisions
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              href="/service/accounting/wht"
              className="flex flex-col p-4 border border-orange-200 dark:border-orange-800 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-900/20 hover:border-orange-300 dark:hover:border-orange-700 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400 text-xs font-bold">W</span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">WHT register</span>
              </div>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Supplier WHT payable (remit to GRA) and customer WHT receivable on sales invoices
              </span>
            </Link>
            <Link
              href="/service/accounting/cit"
              className="flex flex-col p-4 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 text-xs font-bold">C</span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">Corporate Income Tax</span>
              </div>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Create quarterly CIT provisions and post to ledger (25% standard rate)
              </span>
            </Link>
          </div>
        </section>
      </div>
    
  )
}
