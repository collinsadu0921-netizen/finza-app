import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { getCurrentBusiness } from "@/lib/business"
import { hasPermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import { loadBusinessSubscriptionRow } from "@/lib/serviceWorkspace/loadBusinessBillingRow"
import { resolveServiceEntitlement } from "@/lib/serviceWorkspace/resolveServiceEntitlement"
import { evaluatePaystackSalaryEligibility } from "@/lib/payroll/paystack/eligibility"
import { destinationLabel, maskAccountNumber, maskMomoNumber } from "@/lib/payroll/paystack/destination"
import { isPaystackLiveTransfersEnabled } from "@/lib/payroll/paystack/connection"
import { ghsToPesewas, pesewasToGhs } from "@/lib/payroll/paystack/amounts"
import { loadPaystackPaymentContext } from "@/lib/payroll/paystack/paymentContext"

export async function GET(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; batchId: string; itemId: string }>
  }
) {
  try {
    const { id: runId, batchId, itemId } = await Promise.resolve(params)
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
    if (!canPay) {
      return NextResponse.json(
        { error: "You do not have permission to initiate salary payments.", code: "PERMISSION_DENIED" },
        { status: 403 }
      )
    }

    const subscriptionRow = await loadBusinessSubscriptionRow(supabase, business.id)
    const entitlement = resolveServiceEntitlement(subscriptionRow)

    const admin = createSupabaseAdminClient()
    const ctx = await loadPaystackPaymentContext({
      supabase,
      admin,
      businessId: business.id,
      runId,
      batchId,
      itemId,
    })
    if ("error" in ctx) {
      return NextResponse.json({ error: ctx.error, code: ctx.code }, { status: ctx.status })
    }

    const destination = ctx.destination
    const eligibility = evaluatePaystackSalaryEligibility({
      tier: entitlement.effectiveTier,
      business_tier_allows_paystack: entitlement.effectiveTier === "business",
      has_payroll_pay_permission: canPay,
      run_status: ctx.run.status,
      batch_status: ctx.batch.status,
      item_status: ctx.item.status,
      item_payment_id: ctx.item.payroll_payment_id,
      item_amount: ctx.item.amount,
      item_currency: ctx.item.currency,
      destination_valid: destination.ok,
      has_unallocated_aggregate_payment: ctx.hasUnallocatedAggregatePayment,
      connection: {
        exists: Boolean(ctx.connection),
        is_active: Boolean(ctx.connection?.row.is_active),
        status: ctx.connection?.row.status ?? "disconnected",
        environment: ctx.connection?.row.environment ?? null,
      },
      live_transfers_enabled: isPaystackLiveTransfersEnabled(),
      available_balance_pesewas: ctx.balancePesewas,
      active_transfer: ctx.activeTransfer,
    })

    const itemPesewas = ghsToPesewas(ctx.item.amount)
    return NextResponse.json({
      eligible: eligibility.ok,
      code: eligibility.code,
      message: destination.ok ? eligibility.message : destination.message,
      employee: {
        id: ctx.item.staff_id,
        name: ctx.item.employee_name,
      },
      payroll: {
        run_id: ctx.run.id,
        run_status: ctx.run.status,
        payroll_month: ctx.run.payroll_month,
        batch_id: ctx.batch.id,
        batch_status: ctx.batch.status,
        item_id: ctx.item.id,
        item_status: ctx.item.status,
      },
      amount: {
        ghs: ctx.item.amount,
        pesewas: itemPesewas,
        currency: ctx.item.currency || "GHS",
      },
      destination: destination.ok
        ? {
            method_type: destination.method_type,
            label: destinationLabel(ctx.item),
            bank_name: destination.method_type === "bank" ? destination.bank_name : null,
            bank_code: destination.method_type === "bank" ? destination.bank_code : null,
            account_number:
              destination.method_type === "bank"
                ? maskAccountNumber(destination.account_number)
                : null,
            momo_provider:
              destination.method_type === "momo" ? destination.provider_name : null,
            momo_number:
              destination.method_type === "momo" ? maskMomoNumber(destination.momo_number) : null,
            account_name: destination.account_name,
          }
        : null,
      connection: ctx.connection
        ? {
            connected: ctx.connection.row.is_active && ctx.connection.row.status === "connected",
            environment: ctx.connection.row.environment,
          }
        : { connected: false, environment: null },
      balance: {
        ghs: pesewasToGhs(ctx.balancePesewas),
        pesewas: ctx.balancePesewas,
        error: ctx.balanceError,
      },
      fees: {
        note: "Paystack fees are a business expense and are never deducted from the employee's net salary. The final provider fee is recorded separately when Paystack confirms the transfer.",
      },
      active_transfer: ctx.activeTransfer,
      live_transfers_enabled: isPaystackLiveTransfersEnabled(),
    })
  } catch (error: unknown) {
    console.error("[paystack preview]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
