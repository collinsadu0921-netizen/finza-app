import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

/**
 * **Removed / deprecated** (Phase 7) — returns **410 Gone**.
 *
 * Never implemented real MTN; tenant service invoices use:
 * `POST /api/payments/momo/tenant/invoice/initiate` (`business_payment_providers` + `payment_provider_transactions`).
 * Retail RTP remains `POST /api/payments/momo` (legacy `momo_settings`).
 */
export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: "deprecated",
      message:
        "This endpoint is deprecated. Use POST /api/payments/momo/tenant/invoice/initiate for tenant MTN direct invoice payments.",
    },
    { status: 410 }
  )
}
