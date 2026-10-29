import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { getCurrentBusiness } from "@/lib/business"
import { hasPermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import { loadPaystackPayrollConnection } from "@/lib/payroll/paystack/connection"
import {
  finalizePaystackTransfer,
  safePaystackPayrollMessage,
  verifyPaystackTransfer,
} from "@/lib/payroll/paystack/paystackClient"
import { processPaystackTransferProviderResult } from "@/lib/payroll/paystack/transferProcessor"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id: transferId } = await Promise.resolve(params)
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const tierDenied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user.id,
      businessId: business.id,
      minTier: "business",
      mode: "write",
    })
    if (tierDenied) return tierDenied

    const canPay = await hasPermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_PAY)
    if (!canPay) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })

    const body = await request.json().catch(() => null)
    const otp = String(body?.otp ?? "").replace(/\s+/g, "")
    if (!/^\d{4,10}$/.test(otp)) {
      return NextResponse.json({ error: "Enter the Paystack OTP sent to the account owner." }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()
    const { data: transfer, error } = await admin
      .from("payroll_paystack_transfers")
      .select("*")
      .eq("id", transferId)
      .eq("business_id", business.id)
      .maybeSingle()

    if (error || !transfer) {
      return NextResponse.json({ error: "Transfer not found" }, { status: 404 })
    }
    if (transfer.status !== "awaiting_authorization") {
      return NextResponse.json(
        {
          error: "This transfer is not awaiting Paystack authorization.",
          status: transfer.status,
        },
        { status: 409 }
      )
    }
    if (!transfer.provider_transfer_code) {
      return NextResponse.json(
        { error: "Paystack did not provide a transfer code for authorization." },
        { status: 409 }
      )
    }

    const connection = await loadPaystackPayrollConnection(admin, business.id)
    if (!connection?.secretKey || !connection.row.is_active) {
      return NextResponse.json(
        { error: "Paystack connection is inactive. Reconnect before authorizing this transfer." },
        { status: 409 }
      )
    }

    const finalized = await finalizePaystackTransfer(
      connection.secretKey,
      transfer.provider_transfer_code,
      otp
    )

    if (!finalized.ok) {
      const message = safePaystackPayrollMessage(finalized.error)
      return NextResponse.json(
        { error: message, code: finalized.code ?? "PAYSTACK_OTP_FAILED" },
        { status: finalized.httpStatus === 401 ? 400 : 402 }
      )
    }

    let providerData = finalized.data
    const finalStatus = String(finalized.data.status ?? "").toLowerCase()
    if (["success", "successful", "pending", "processing", "queued"].includes(finalStatus)) {
      const verified = await verifyPaystackTransfer(connection.secretKey, transfer.reference)
      if (verified.ok) providerData = verified.data
    }

    const outcome = await processPaystackTransferProviderResult({
      admin,
      transfer: transfer as Parameters<typeof processPaystackTransferProviderResult>[0]["transfer"],
      providerData,
      source: "verification",
    })

    return NextResponse.json({
      transfer_id: transfer.id,
      reference: transfer.reference,
      status: outcome.status,
      message: outcome.message,
      otp_required: false,
    })
  } catch (error: unknown) {
    console.error("[paystack otp]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
