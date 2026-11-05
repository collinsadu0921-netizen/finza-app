import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { getCurrentBusiness } from "@/lib/business"
import { hasPermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import { loadPaystackPayrollConnection } from "@/lib/payroll/paystack/connection"
import {
  fetchPaystackGhsBalancePesewas,
  isPaystackPayrollMockMode,
} from "@/lib/payroll/paystack/paystackClient"
import { pesewasToGhs } from "@/lib/payroll/paystack/amounts"

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

    const canPay = await hasPermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_PAY)
    if (!canPay) {
      return NextResponse.json({ enabled: false, connected: false, reason: "PAYROLL_PAY_REQUIRED" })
    }

    const admin = createSupabaseAdminClient()
    const connection = await loadPaystackPayrollConnection(admin, business.id)
    if (!connection?.row.is_active || !connection.secretKey || connection.row.status !== "connected") {
      return NextResponse.json({
        enabled: false,
        connected: false,
        environment: connection?.row.environment ?? null,
        reason: "PAYSTACK_CONNECTION_REQUIRED",
      })
    }

    const balance = await fetchPaystackGhsBalancePesewas(connection.secretKey)
    return NextResponse.json({
      enabled: true,
      connected: true,
      environment: connection.row.environment,
      mock_mode: isPaystackPayrollMockMode(),
      balance_ghs: balance.ok ? pesewasToGhs(balance.data.balance_pesewas) : null,
      balance_error: balance.ok ? null : balance.error,
    })
  } catch (error: unknown) {
    console.error("[paystack status GET]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
