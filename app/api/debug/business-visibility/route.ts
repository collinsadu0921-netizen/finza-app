import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

/** TEMP: Forensic — prove owner can SELECT business row under RLS. Remove after diagnosis. */
const TARGET_BUSINESS_ID = "8aa623a8-9536-47b9-8f0f-791cb8750b0e"

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { userId: null, businessId: TARGET_BUSINESS_ID, row: null, error: "Unauthorized" },
      { status: 401 }
    )
  }
  const { data: row, error } = await supabase
    .from("businesses")
    .select("id, name, owner_id")
    .eq("id", TARGET_BUSINESS_ID)
    .maybeSingle()
  return NextResponse.json({
    userId: user.id,
    businessId: TARGET_BUSINESS_ID,
    row: row ?? null,
    error: error?.message ?? null,
  })
}
