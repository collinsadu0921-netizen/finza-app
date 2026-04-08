/**
 * Unified service subscription checkout: Paystack (card + MoMo) or MTN MoMo sandbox (MoMo only).
 * Reuses the same subscription metadata and applyPaystackSubscriptionWebhook / Paystack webhooks.
 */

import { NextRequest } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { initiateServiceSubscriptionPayment } from "@/lib/payments/subscriptionGateway/initiateServiceSubscription"
import type { SubscriptionInitiateBody } from "@/lib/payments/subscriptionGateway/types"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: SubscriptionInitiateBody
  try {
    body = (await request.json()) as SubscriptionInitiateBody
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  return initiateServiceSubscriptionPayment(request, supabase, user, body)
}
