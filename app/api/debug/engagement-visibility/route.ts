import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

/** TEMP: Forensic — prove owner can SELECT engagement row under RLS. Remove after diagnosis. */
const TARGET_ENGAGEMENT_ID = "6896b6e6-50ad-441c-a4d8-972ca8f98330"

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { userId: null, engagementId: TARGET_ENGAGEMENT_ID, row: null, error: "Unauthorized" },
      { status: 401 }
    )
  }
  const { data: row, error } = await supabase
    .from("firm_client_engagements")
    .select("id, client_business_id, accounting_firm_id, status")
    .eq("id", TARGET_ENGAGEMENT_ID)
    .maybeSingle()
  return NextResponse.json({
    userId: user.id,
    engagementId: TARGET_ENGAGEMENT_ID,
    row: row ?? null,
    error: error?.message ?? null,
  })
}
