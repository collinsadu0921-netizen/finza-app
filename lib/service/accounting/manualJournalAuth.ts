import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import { getUserRole, isUserAccountantReadonly } from "@/lib/userRoles"

export type ServiceManualJournalRole = "owner" | "admin" | "accountant"

export type ServiceManualJournalAuthority =
  | {
      ok: true
      role: ServiceManualJournalRole
      canWrite: boolean
      businessId: string
      defaultCurrency: string | null
    }
  | {
      ok: false
      response: NextResponse
    }

const SERVICE_INDUSTRIES = new Set(["service", "professional"])
const WRITE_ROLES = new Set(["owner", "admin", "accountant"])

function denial(status: number, code: string, message: string): ServiceManualJournalAuthority {
  return {
    ok: false,
    response: NextResponse.json({ error: message, code }, { status }),
  }
}

/**
 * Service-only authority for manual journals.
 *
 * Allowed roles: owner, admin, accountant. An accountant_readonly user may read
 * but cannot create, post or reverse. Accounting-firm authority is deliberately
 * NOT consulted here; Practice uses its own workflow.
 */
export async function resolveServiceManualJournalAuthority(params: {
  supabase: SupabaseClient
  userId: string | null | undefined
  businessId: string | null | undefined
  required: "read" | "write"
}): Promise<ServiceManualJournalAuthority> {
  const businessId = (params.businessId || "").trim()
  if (!params.userId) {
    return denial(401, "UNAUTHORIZED", "Authentication is required.")
  }
  if (!businessId) {
    return denial(400, "MISSING_BUSINESS_ID", "business_id is required.")
  }

  const denied = await enforceServiceWorkspaceAccess({
    supabase: params.supabase,
    userId: params.userId,
    businessId,
    minTier: "business",
    mode: params.required === "write" ? "write" : "read",
  })
  if (denied) {
    const body = await denied.clone().json().catch(() => ({}))
    return denial(
      denied.status,
      typeof body?.code === "string" ? body.code : "SERVICE_ACCESS_DENIED",
      typeof body?.error === "string" ? body.error : "You do not have access to this Service workspace."
    )
  }

  const { data: business, error: businessError } = await params.supabase
    .from("businesses")
    .select("id, industry, archived_at, default_currency")
    .eq("id", businessId)
    .maybeSingle()

  if (businessError) {
    return denial(500, "BUSINESS_LOOKUP_FAILED", "Unable to verify the business.")
  }
  if (!business || business.archived_at) {
    return denial(403, "BUSINESS_UNAVAILABLE", "This business is not available.")
  }

  const industry = String(business.industry || "").toLowerCase()
  if (!SERVICE_INDUSTRIES.has(industry)) {
    return denial(403, "NOT_SERVICE_WORKSPACE", "Manual journals are available only in the Service workspace.")
  }

  const role = await getUserRole(params.supabase, params.userId, businessId)
  if (!role || !WRITE_ROLES.has(role)) {
    return denial(403, "FORBIDDEN", "You do not have permission to access manual journals for this business.")
  }

  const readonly = role === "accountant"
    ? await isUserAccountantReadonly(params.supabase, params.userId, businessId)
    : false

  if (params.required === "write" && readonly) {
    return denial(403, "ACCOUNTANT_READONLY", "Your accountant access is read-only. You cannot create, post or reverse manual journals.")
  }

  let canWrite = !readonly
  if (params.required === "read" && canWrite) {
    const writeGate = await enforceServiceWorkspaceAccess({
      supabase: params.supabase,
      userId: params.userId,
      businessId,
      minTier: "business",
      mode: "write",
    })
    canWrite = !writeGate
  }

  return {
    ok: true,
    role: role as ServiceManualJournalRole,
    canWrite,
    businessId,
    defaultCurrency: (business.default_currency as string | null) ?? null,
  }
}
