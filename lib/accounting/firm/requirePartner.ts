import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { isUserFirmPartner } from "@/lib/accounting/firm/onboarding"
import { resolveWorkFirmId } from "@/lib/practice/work/scope"

export async function requirePartnerForFirmApi(
  supabase: SupabaseClient,
  userId: string,
  requestedFirmId: string | null
): Promise<{ firmId: string } | NextResponse> {
  const { data: memberships, error } = await supabase
    .from("accounting_firm_users")
    .select("firm_id, role")
    .eq("user_id", userId)

  if (error) {
    console.error("requirePartnerForFirmApi membership lookup:", error)
    return NextResponse.json({ error: "Failed to verify firm membership" }, { status: 500 })
  }

  const resolved = resolveWorkFirmId({
    memberships: memberships ?? [],
    requestedFirmId,
  })

  if (!resolved.firmId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const isPartner = await isUserFirmPartner(supabase, userId, resolved.firmId)
  if (!isPartner) {
    return NextResponse.json(
      { error: "Forbidden. Partner role required." },
      { status: 403 }
    )
  }

  return { firmId: resolved.firmId }
}
