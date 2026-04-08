import { NextResponse } from "next/server"
import { isMtnMomoSandboxSubscriptionConfigured } from "@/lib/payments/subscriptionGateway/mtnMomoSandboxProvider"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({
    paystack: !!process.env.PAYSTACK_SECRET_KEY?.trim(),
    mtn_momo_sandbox: isMtnMomoSandboxSubscriptionConfigured(),
  })
}
