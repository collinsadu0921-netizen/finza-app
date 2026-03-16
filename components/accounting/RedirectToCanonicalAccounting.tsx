"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { resolveServiceBusinessContext } from "@/lib/serviceBusinessContext"
import ProtectedLayout from "@/components/ProtectedLayout"

type Props = {
  /** Canonical path without query, e.g. /accounting/ledger */
  canonicalPath: string
  /** Optional search params to append (e.g. highlight=xyz). Do not include leading ? or business_id. */
  search?: string
}

/**
 * Resolves current service business and redirects to canonical accounting route with business_id.
 * Used by legacy /service/ledger and /service/reports/* pages.
 */
export default function RedirectToCanonicalAccounting({ canonicalPath, search }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<"loading" | "redirecting" | "no-context">("loading")

  useEffect(() => {
    let cancelled = false
    async function run() {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || cancelled) {
        if (!cancelled) {
          router.replace("/accounting")
          setStatus("redirecting")
        }
        return
      }
      const ctx = await resolveServiceBusinessContext(supabase, user.id)
      if (cancelled) return
      if ("error" in ctx) {
        setStatus("no-context")
        return
      }
      const q = new URLSearchParams()
      q.set("business_id", ctx.businessId)
      if (search) {
        search.split("&").forEach((pair) => {
          const [k, v] = pair.split("=")
          if (k && v) q.set(k, v)
        })
      }
      router.replace(`${canonicalPath}?${q.toString()}`)
      setStatus("redirecting")
    }
    run()
    return () => {
      cancelled = true
    }
  }, [canonicalPath, search, router])

  if (status === "no-context") {
    return (
      <ProtectedLayout>
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="text-center">
            <p className="text-gray-600 dark:text-gray-400 mb-4">No business context. Open Accounting workspace to select a client.</p>
            <button
              type="button"
              onClick={() => router.push("/accounting")}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              Open Accounting
            </button>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        <span className="ml-3 text-gray-600 dark:text-gray-400">Redirecting…</span>
      </div>
    </ProtectedLayout>
  )
}
