import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { getCurrentBusiness } from "@/lib/business"
import { hasPermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import { loadPaystackPayrollConnection } from "@/lib/payroll/paystack/connection"
import { safePaystackPayrollMessage, verifyPaystackTransfer } from "@/lib/payroll/paystack/paystackClient"
import { processPaystackTransferProviderResult } from "@/lib/payroll/paystack/transferProcessor"

export async function POST(
  _request: NextRequest,
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
      mode: "read",
    })
    if (tierDenied) return tierDenied

    const canPay = await hasPermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_PAY)
    if (!canPay) {
      return NextResponse.json(
        {
          error: "You do not have permission to verify or settle salary payments.",
          code: "PERMISSION_DENIED",
        },
        { status: 403 }
      )
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

    if (transfer.status === "successful" || transfer.status === "reversed") {
      return NextResponse.json({
        transfer_id: transfer.id,
        reference: transfer.reference,
        status: transfer.status,
        message:
          transfer.status === "successful"
            ? "This salary transfer is already confirmed."
            : "This salary transfer was reversed.",
        verified: true,
      })
    }

    const connection = await loadPaystackPayrollConnection(admin, business.id)
    if (!connection?.secretKey || !connection.row.is_active) {
      return NextResponse.json(
        { error: "Paystack connection is inactive. Reconnect before verifying this transfer." },
        { status: 409 }
      )
    }

    const verified = await verifyPaystackTransfer(connection.secretKey, transfer.reference)
    if (!verified.ok) {
      return NextResponse.json(
        {
          error: safePaystackPayrollMessage(verified.error),
          code: verified.code ?? "PAYSTACK_VERIFY_FAILED",
          status: transfer.status,
        },
        { status: verified.httpStatus === 404 ? 404 : 502 }
      )
    }

    const outcome = await processPaystackTransferProviderResult({
      admin,
      transfer: transfer as Parameters<typeof processPaystackTransferProviderResult>[0]["transfer"],
      providerData: verified.data,
      source: "verification",
    })

    return NextResponse.json({
      transfer_id: transfer.id,
      reference: transfer.reference,
      status: outcome.status,
      message: outcome.message,
      verified: true,
    })
  } catch (error: unknown) {
    console.error("[paystack verify]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
