import { NextResponse } from "next/server"

/**
 * Legacy retail MTN request-to-pay.
 * Disabled for Shop #1. Cashiers record Card or MoMo from a standalone bank
 * terminal and store the reference on the sale. This route must not read
 * momo_settings or call MTN.
 */
export async function POST() {
  return NextResponse.json(
    {
      status: "failed",
      code: "RETAIL_MOMO_RTP_DISABLED",
      message: "Retail Mobile Money collection is not enabled. Record the bank-terminal reference on the sale instead.",
    },
    { status: 410 }
  )
}
