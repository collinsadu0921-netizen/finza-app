/**
 * Distinguishes normal Service context from Practice client-books context.
 *
 * Normal Service user → owned/employed business (existing resolver).
 * Firm practitioner → explicit business_id + getAccountingAuthority.
 *
 * URL business_id is never a universal impersonation mechanism.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { resolveServiceBusinessContext } from "@/lib/serviceBusinessContext"
import { getUserRole } from "@/lib/userRoles"

export type PracticeBooksAccessLevel = "read" | "write" | "approve"

export type PracticeClientBooksContext =
  | {
      kind: "service"
      businessId: string
    }
  | {
      kind: "practice"
      businessId: string
      clientName: string
      accessLevel: PracticeBooksAccessLevel
      firmId: string
      engagementId: string
    }
  | {
      kind: "denied"
      reason: string
    }
  | {
      kind: "no_context"
    }

async function isFirmMember(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("accounting_firm_users")
    .select("firm_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle()
  return Boolean(data?.firm_id)
}

async function loadBusinessName(
  supabase: SupabaseClient,
  businessId: string
): Promise<string> {
  const { data } = await supabase
    .from("businesses")
    .select("name")
    .eq("id", businessId)
    .maybeSingle()
  return (data?.name as string | undefined)?.trim() || "Client"
}

export async function resolvePracticeClientBooksContext(opts: {
  supabase: SupabaseClient
  userId: string
  urlBusinessId?: string | null
}): Promise<PracticeClientBooksContext> {
  const urlBusinessId = opts.urlBusinessId?.trim() || null
  const firmMember = await isFirmMember(opts.supabase, opts.userId)

  if (firmMember && urlBusinessId) {
    const auth = await getAccountingAuthority({
      supabase: opts.supabase,
      firmUserId: opts.userId,
      businessId: urlBusinessId,
      requiredLevel: "read",
    })
    if (!auth.allowed || !auth.level || !auth.firmId || !auth.engagementId) {
      return { kind: "denied", reason: auth.reason || "ENGAGEMENT_REQUIRED" }
    }
    const clientName = await loadBusinessName(opts.supabase, urlBusinessId)
    return {
      kind: "practice",
      businessId: urlBusinessId,
      clientName,
      accessLevel: auth.level,
      firmId: auth.firmId,
      engagementId: auth.engagementId,
    }
  }

  const serviceCtx = await resolveServiceBusinessContext(opts.supabase, opts.userId)
  if ("businessId" in serviceCtx) {
    if (urlBusinessId && urlBusinessId !== serviceCtx.businessId) {
      const role = await getUserRole(opts.supabase, opts.userId, urlBusinessId)
      if (role === "owner" || role === "admin" || role === "accountant") {
        return { kind: "service", businessId: urlBusinessId }
      }
      return { kind: "denied", reason: "CROSS_BUSINESS_DENIED" }
    }
    return { kind: "service", businessId: serviceCtx.businessId }
  }

  if (firmMember && !urlBusinessId) {
    return { kind: "no_context" }
  }

  return { kind: "no_context" }
}
