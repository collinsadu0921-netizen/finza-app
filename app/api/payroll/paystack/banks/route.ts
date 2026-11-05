import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { getCurrentBusiness } from "@/lib/business"
import { hasPermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import { loadPaystackPayrollConnection } from "@/lib/payroll/paystack/connection"
import { listPaystackGhanaBanks } from "@/lib/payroll/paystack/paystackClient"

export async function GET(_request: NextRequest) {
  try {
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

    const canPayroll = await hasPermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_VIEW)
    const canManageStaff = await hasPermission(supabase, user.id, business.id, PERMISSIONS.STAFF_MANAGE)
    const canPay = await hasPermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_PAY)
    if (!canPayroll && !canManageStaff && !canPay) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    const admin = createSupabaseAdminClient()
    const connection = await loadPaystackPayrollConnection(admin, business.id)
    if (!connection?.row.is_active || !connection.secretKey || connection.row.status !== "connected") {
      return NextResponse.json(
        {
          error:
            "Connect your business Paystack account before selecting Paystack-supported banks and Mobile Money networks.",
          code: "PAYSTACK_CONNECTION_REQUIRED",
        },
        { status: 409 }
      )
    }

    const [banksResult, momoResult] = await Promise.all([
      listPaystackGhanaBanks(connection.secretKey, "ghipss"),
      listPaystackGhanaBanks(connection.secretKey, "mobile_money"),
    ])

    if (!banksResult.ok) {
      return NextResponse.json(
        { error: banksResult.error, code: banksResult.code },
        { status: banksResult.httpStatus === 401 ? 400 : 502 }
      )
    }
    if (!momoResult.ok) {
      return NextResponse.json(
        { error: momoResult.error, code: momoResult.code },
        { status: momoResult.httpStatus === 401 ? 400 : 502 }
      )
    }

    return NextResponse.json({
      environment: connection.row.environment,
      banks: banksResult.data.banks,
      mobile_money: momoResult.data.banks.map((network) => ({
        name: network.name,
        code: network.code,
        label:
          network.code === "MTN"
            ? "MTN Mobile Money"
            : network.code === "VOD"
              ? "Telecel Cash (Vodafone)"
              : network.code === "ATL"
                ? "AirtelTigo Money"
                : network.name,
      })),
    })
  } catch (error: unknown) {
    console.error("[paystack banks GET]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
