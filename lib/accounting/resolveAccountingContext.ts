/**
 * Wave 13: Single authority resolver for accounting workspace.
 * ONLY valid resolver for accounting context. No cookie/session; URL-authoritative for accountants.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { getCurrentBusiness } from "@/lib/business"
import { logAccountingContextResolverUsage } from "./devContextLogger"
import { CLIENT_REQUIRED } from "./reasonCodes"

export type AccountingAuthoritySource = "accountant" | "owner" | "employee"

export type ResolveAccountingContextResult =
  | { businessId: string; authoritySource: AccountingAuthoritySource }
  | { error: typeof CLIENT_REQUIRED }

export type SearchParamsLike = { get(key: string): string | null }

export type ResolveAccountingContextOpts = {
  supabase?: SupabaseClient
  userId?: string
  searchParams?: SearchParamsLike
  pathname?: string
  /** Caller source for dev logging (workspace | api | portal | reports) */
  source?: "workspace" | "api" | "portal" | "reports"
}

/**
 * Resolve business context for accounting workspace and related routes (portal, reports).
 * - Accountant: MUST have business_id in URL. Missing → CLIENT_REQUIRED (dev log).
 * - Owner/Employee: Use business_id from URL if present; else fallback to getCurrentBusiness.
 */
export async function resolveAccountingContext(
  opts: ResolveAccountingContextOpts
): Promise<ResolveAccountingContextResult> {
  const { supabase, userId, searchParams, pathname, source } = opts
  const urlBusinessId = (searchParams?.get("business_id") ?? searchParams?.get("businessId"))?.trim() ?? null

  if (!supabase || !userId) {
    if (urlBusinessId) {
      return { businessId: urlBusinessId, authoritySource: "owner" }
    }
    return { error: CLIENT_REQUIRED }
  }

  const { data: firmUser } = await supabase
    .from("accounting_firm_users")
    .select("firm_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle()

  const isAccountant = !!firmUser

  if (isAccountant) {
    if (!urlBusinessId) {
      if (process.env.NODE_ENV === "development") {
        console.error("[accounting] Accountant accessed without business_id — URL is required:", pathname ?? "(no pathname)")
      }
      logAccountingContextResolverUsage(source ?? "workspace")
      return { error: CLIENT_REQUIRED }
    }
    return { businessId: urlBusinessId, authoritySource: "accountant" }
  }

  if (urlBusinessId) {
    const { data: biz } = await supabase
      .from("businesses")
      .select("owner_id")
      .eq("id", urlBusinessId)
      .maybeSingle()
    const authoritySource: AccountingAuthoritySource = biz?.owner_id === userId ? "owner" : "employee"
    return { businessId: urlBusinessId, authoritySource }
  }

  const business = await getCurrentBusiness(supabase, userId)
  if (!business?.id) {
    return { error: CLIENT_REQUIRED }
  }
  const authoritySource: AccountingAuthoritySource = business.owner_id === userId ? "owner" : "employee"
  return { businessId: business.id, authoritySource }
}
