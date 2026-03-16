/**
 * Reusable auth guard for business-scoped API routes.
 * Reads session, validates business membership, enforces RBAC.
 * No cross-tenant access: businessId must match user's membership (owner or business_users).
 */

import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getUserRole } from "@/lib/userRoles"

export type AllowedRole = "owner" | "admin" | "accountant"

const DEFAULT_ALLOWED: AllowedRole[] = ["owner", "admin", "accountant"]

export type RequireBusinessRoleSuccess = {
  userId: string
  businessId: string
  role: string
}

export type RequireBusinessRoleResult = RequireBusinessRoleSuccess | NextResponse

/**
 * Reads session, loads membership from businesses.owner_id / business_users,
 * returns { userId, businessId, role } or a NextResponse to return (401/403).
 * Caller must return the result when it is a NextResponse.
 *
 * Enforces:
 * - Authentication required (401 if no session).
 * - businessId required (400 if missing).
 * - User must have membership for businessId (403 if not owner and not in business_users).
 * - Role must be in allowedRoles (403 otherwise).
 */
export async function requireBusinessRole(
  supabase: SupabaseClient,
  businessId: string | undefined,
  options?: { allowedRoles?: AllowedRole[] }
): Promise<RequireBusinessRoleResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  if (!businessId || businessId.trim() === "") {
    return NextResponse.json(
      { error: "Missing businessId" },
      { status: 400 }
    )
  }

  const role = await getUserRole(supabase, user.id, businessId)
  if (!role) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
  }

  const allowed = new Set(options?.allowedRoles ?? DEFAULT_ALLOWED)
  if (!allowed.has(role as AllowedRole)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
  }

  return { userId: user.id, businessId, role }
}
