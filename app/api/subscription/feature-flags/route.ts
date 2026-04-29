import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { isMockSubscriptionFlowEnabled, safeHubtelMode } from "@/lib/payments/subscription/mockFeatureFlag"

export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const mock_checkout_enabled = isMockSubscriptionFlowEnabled()
  const hubtel_mode = safeHubtelMode()

  return NextResponse.json({
    mock_checkout_enabled,
    hubtel_mode,
  })
}

