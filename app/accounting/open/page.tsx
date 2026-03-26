/**
 * Canonical "Open Accounting" entry for accountants (Wave 14/15).
 * Validates authority (single evaluator) + readiness; no duplicated engagement logic.
 */

import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { buildAccountingRoute } from "@/lib/accounting/routes"
import {
  NO_ENGAGEMENT,
  ENGAGEMENT_PENDING,
  ENGAGEMENT_SUSPENDED,
  ENGAGEMENT_TERMINATED,
  ENGAGEMENT_NOT_EFFECTIVE,
} from "@/lib/accounting/reasonCodes"
import Link from "next/link"
import ProtectedLayout from "@/components/ProtectedLayout"

const REASON_MESSAGE: Record<string, string> = {
  [NO_ENGAGEMENT]: "No engagement exists for this client.",
  [ENGAGEMENT_PENDING]: "Engagement is pending acceptance.",
  [ENGAGEMENT_SUSPENDED]: "Engagement is suspended.",
  [ENGAGEMENT_TERMINATED]: "Engagement is terminated.",
  [ENGAGEMENT_NOT_EFFECTIVE]: "Engagement is not effective for the current date.",
}

export default async function AccountingOpenPage({
  searchParams,
}: {
  searchParams: Promise<{ business_id?: string }>
}) {
  const params = await searchParams
  const businessId = (params.business_id ?? "").trim() || null

  if (!businessId) {
    redirect("/accounting")
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: firmUser } = await supabase
    .from("accounting_firm_users")
    .select("firm_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle()

  const isAccountant = !!firmUser
  if (!isAccountant) {
    redirect(buildAccountingRoute("/accounting", businessId))
  }

  const auth = await getAccountingAuthority({
    supabase,
    firmUserId: user.id,
    businessId,
    requiredLevel: "read",
  })

  if (!auth.allowed) {
    const message = REASON_MESSAGE[auth.reason] ?? auth.reason
    return (
      <ProtectedLayout>
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
          <div className="max-w-md w-full rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6 text-center">
            <p className="font-semibold text-red-800 dark:text-red-200 mb-2">Access denied</p>
            <p className="text-sm text-red-700 dark:text-red-300 mb-4">{message}</p>
            <p className="text-xs text-red-600 dark:text-red-400 mb-4">Reason: {auth.reason}</p>
            <Link
              href="/accounting/control-tower"
              className="inline-block px-4 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-medium"
            >
              Go to Control Tower
            </Link>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  const { ready } = await checkAccountingReadiness(supabase, businessId)
  if (!ready) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
          <div className="max-w-md w-full rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-6 text-center">
            <p className="font-semibold text-amber-800 dark:text-amber-200 mb-2">
              Accounting not initialized for this client
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-300 mb-4">
              The client must have accounting initialized before you can open the workspace.
            </p>
            <Link
              href="/accounting/control-tower"
              className="inline-block px-4 py-2 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium"
            >
              Go to Control Tower
            </Link>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  redirect(buildAccountingRoute("/accounting", businessId))
}
