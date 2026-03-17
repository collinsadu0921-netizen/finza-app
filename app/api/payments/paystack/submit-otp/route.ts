/**
 * Paystack submit OTP — for Vodafone Cash charges that return "send_otp"
 *
 * POST /api/payments/paystack/submit-otp
 * Body: { otp: "123456", reference: "FNZ-xxx" }
 */

import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY
  if (!secretKey) {
    return NextResponse.json({ success: false, error: "Paystack not configured" }, { status: 503 })
  }

  let body: { otp: string; reference: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  const { otp, reference } = body
  if (!otp || !reference) {
    return NextResponse.json({ success: false, error: "otp and reference are required" }, { status: 400 })
  }

  const res = await fetch("https://api.paystack.co/charge/submit_otp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ otp, reference }),
  })

  const data = await res.json()

  if (!res.ok || !data.status) {
    return NextResponse.json({ success: false, error: data.message || "OTP submission failed" }, { status: 400 })
  }

  const chargeStatus: string = data.data?.status ?? "pending"

  return NextResponse.json({
    success: chargeStatus !== "failed",
    status: chargeStatus, // "success" | "pay_offline" | "failed"
    reference,
  })
}
