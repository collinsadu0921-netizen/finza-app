import type { SupabaseClient } from "@supabase/supabase-js"
import {
  getUserRole,
  isUserAccountantReadonly,
} from "@/lib/userRoles"

export type AccountingWriteRoleDenied = {
  status: 403
  error: string
  code: string
}

/**
 * Main-compatible accounting-write role gate.
 *
 * Mirrors the role/read-only portion of the database ledger guard using the
 * existing user-role helpers. Subscription/tier checks remain with the
 * route's existing service-workspace guard.
 */
export async function requireAccountingWriteRole(
  supabase: SupabaseClient,
  userId: string,
  businessId: string
): Promise<AccountingWriteRoleDenied | null> {
  const role = await getUserRole(supabase, userId, businessId)

  if (!role) {
    return {
      status: 403,
      error: "Forbidden: no access to this business",
      code: "ACCOUNTING_WRITE_FORBIDDEN",
    }
  }

  if (role !== "owner" && role !== "admin" && role !== "accountant") {
    return {
      status: 403,
      error: "Forbidden: accounting write authority is required",
      code: "ACCOUNTING_WRITE_PERMISSION_DENIED",
    }
  }

  if (
    role === "accountant" &&
    (await isUserAccountantReadonly(supabase, userId, businessId))
  ) {
    return {
      status: 403,
      error: "Forbidden: accountant access is read-only",
      code: "ACCOUNTING_WRITE_READ_ONLY",
    }
  }

  return null
}
