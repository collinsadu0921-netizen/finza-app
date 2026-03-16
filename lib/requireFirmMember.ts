/**
 * API guard: require the current user to be a member of accounting_firm_users.
 * Use in firm-only and admin/accounting API routes before performing any logic.
 * Returns a 403 NextResponse if the user is not a firm member; returns null if allowed.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

export async function requireFirmMemberForApi(
  supabase: SupabaseClient,
  userId: string
): Promise<NextResponse | null> {
  const { data: firmUser, error } = await supabase
    .from("accounting_firm_users")
    .select("firm_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("requireFirmMember: error fetching firm membership", error)
    return NextResponse.json(
      { error: "Failed to verify firm membership" },
      { status: 500 }
    )
  }

  if (!firmUser?.firm_id) {
    return NextResponse.json(
      { error: "Forbidden. Accounting firm membership required." },
      { status: 403 }
    )
  }

  return null
}
