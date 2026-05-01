import { NextResponse } from "next/server"
import { isMtnMomoSandboxSubscriptionConfigured } from "@/lib/payments/subscriptionGateway/mtnMomoSandboxProvider"

export const dynamic = "force-dynamic"

/**
 * Service subscription checkout uses Paystack **server-side** APIs
 * (`PAYSTACK_SECRET_KEY`). `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` is not consulted here;
 * it may still be required for other client-side Paystack surfaces.
 */
export async function GET() {
  const paystack = !!process.env.PAYSTACK_SECRET_KEY?.trim()
  const mtn_momo_sandbox = isMtnMomoSandboxSubscriptionConfigured()

  if (!paystack && !mtn_momo_sandbox && process.env.NODE_ENV === "development") {
    console.warn("[subscription/options] No subscription checkout gateway:", {
      PAYSTACK_SECRET_KEY: paystack ? "set" : "missing",
      NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY?.trim()
        ? "set (not used for this check)"
        : "missing",
      FINZA_SUBSCRIPTION_PAYMENT_GATEWAY: process.env.FINZA_SUBSCRIPTION_PAYMENT_GATEWAY ?? "(unset)",
      mtn_momo_sandbox_configured: mtn_momo_sandbox,
    })
  }

  const body: Record<string, unknown> = { paystack, mtn_momo_sandbox }
  if (process.env.NODE_ENV === "development" && !paystack && !mtn_momo_sandbox) {
    body._devHint =
      "Server-side Paystack subscription checkout requires PAYSTACK_SECRET_KEY in this environment (e.g. Vercel Production server env, not Preview, unless duplicated)."
  }

  return NextResponse.json(body)
}
