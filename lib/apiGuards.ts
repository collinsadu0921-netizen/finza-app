/**
 * API Route Guards
 * Enforces read-only access for accountant_readonly users
 */

import { NextRequest, NextResponse } from "next/server"
import { SupabaseClient } from "@supabase/supabase-js"
import { getCurrentBusiness } from "@/lib/business"
import { isUserAccountantReadonly } from "@/lib/userRoles"

/**
 * Check if user is accountant_readonly and block write operations
 * Returns null if access is allowed, or a NextResponse with 403 if blocked
 */
export async function checkAccountantReadonlyWriteAccess(
  supabase: SupabaseClient,
  request: NextRequest,
  method: string
): Promise<NextResponse | null> {
  // Only block write methods (POST, PUT, DELETE, PATCH)
  const writeMethods = ["POST", "PUT", "DELETE", "PATCH"]
  if (!writeMethods.includes(method.toUpperCase())) {
    return null // GET requests are allowed
  }

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return null // Let other auth checks handle unauthorized users
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return null // Let other checks handle missing business
    }

    const accountantReadonly = await isUserAccountantReadonly(supabase, user.id, business.id)
    
    if (accountantReadonly) {
      return NextResponse.json(
        { error: "Write operations are not allowed for read-only accountant access" },
        { status: 403 }
      )
    }

    return null // Access allowed
  } catch (error) {
    console.error("Error checking accountant_readonly access:", error)
    return null // On error, let other checks handle it
  }
}





