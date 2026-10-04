import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveAuthenticatedApiUser } from "@/lib/server/resolveAuthenticatedApiUser"
import { getUserRole } from "@/lib/userRoles"

const LIST_ROLES = ["owner", "admin", "manager", "employee"]
const RECEIPT_ROLES = ["owner", "admin", "manager", "employee", "cashier"]

export type RetailSalesReader =
  | {
      ok: true
      userId: string
      role: string
      businessId: string
    }
  | { ok: false; response: NextResponse }

/**
 * Session user only. Caller-supplied user_id is ignored.
 */
export async function requireRetailSalesReader(
  request: NextRequest,
  businessId: string | null,
  purpose: "list" | "receipt"
): Promise<RetailSalesReader> {
  if (!businessId || !businessId.trim()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      ),
    }
  }

  const supabase = await createSupabaseServerClient()
  const auth = await resolveAuthenticatedApiUser(supabase, {
    cookieHeader: request.headers.get("cookie"),
  })
  if (!auth.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    }
  }

  const role = await getUserRole(supabase, auth.user.id, businessId)
  const allowed = purpose === "list" ? LIST_ROLES : RECEIPT_ROLES
  if (!role || !allowed.includes(role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Access denied" }, { status: 403 }),
    }
  }

  return { ok: true, userId: auth.user.id, role, businessId }
}
