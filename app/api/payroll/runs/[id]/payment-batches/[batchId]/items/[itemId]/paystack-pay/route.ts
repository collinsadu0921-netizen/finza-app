import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { getCurrentBusiness } from "@/lib/business"
import { hasPermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import { loadBusinessSubscriptionRow } from "@/lib/serviceWorkspace/loadBusinessBillingRow"
import { resolveServiceEntitlement } from "@/lib/serviceWorkspace/resolveServiceEntitlement"
import { evaluatePaystackSalaryEligibility } from "@/lib/payroll/paystack/eligibility"
import {
  buildPaystackRecipientInput,
  destinationForStorage,
  resolvePaystackDestination,
} from "@/lib/payroll/paystack/destination"
import {
  createPaystackRecipient,
  initiatePaystackTransfer,
  safePaystackPayrollMessage,
  verifyPaystackTransfer,
} from "@/lib/payroll/paystack/paystackClient"
import { ghsToPesewas, pesewasToGhs } from "@/lib/payroll/paystack/amounts"
import { isPaystackLiveTransfersEnabled } from "@/lib/payroll/paystack/connection"
import { loadPaystackPaymentContext } from "@/lib/payroll/paystack/paymentContext"
import {
  processPaystackTransferProviderResult,
  type PayrollPaystackTransferRow,
} from "@/lib/payroll/paystack/transferProcessor"
import { resolvePayrollIdempotencyKey } from "@/lib/payroll/resolvePayrollIdempotencyKey"

type TransferRow = PayrollPaystackTransferRow &
  Record<string, unknown> & { id: string; status: string; reference: string }

async function loadTransferByKey(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: string,
  idempotencyKey: string
): Promise<TransferRow | null> {
  const { data } = await admin
    .from("payroll_paystack_transfers")
    .select("*")
    .eq("business_id", businessId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle()
  return (data as TransferRow | null) ?? null
}

async function loadActiveTransferForItem(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: string,
  itemId: string
): Promise<TransferRow | null> {
  const { data } = await admin
    .from("payroll_paystack_transfers")
    .select("*")
    .eq("business_id", businessId)
    .eq("batch_item_id", itemId)
    .in("status", ["initiating", "awaiting_authorization", "pending", "successful"])
    .maybeSingle()
  return (data as TransferRow | null) ?? null
}

function transferResponse(transfer: TransferRow, message: string, extra?: Record<string, unknown>) {
  return {
    transfer_id: String(transfer.id),
    reference: String(transfer.reference),
    status: String(transfer.status),
    provider_status: transfer.provider_status ?? null,
    otp_required: transfer.status === "awaiting_authorization",
    message,
    ...extra,
  }
}

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; batchId: string; itemId: string }>
  }
) {
  let attemptForFailure: { admin: ReturnType<typeof createSupabaseAdminClient>; id: string } | null = null
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

    const body = await request.json().catch(() => null)
    if (!body || body.confirm !== true) {
      return NextResponse.json(
        {
          error: "Explicit confirmation is required before a Paystack salary transfer can be initiated.",
          code: "PAYSTACK_CONFIRMATION_REQUIRED",
        },
        { status: 400 }
      )
    }

    const idempotency = resolvePayrollIdempotencyKey(request, body)
    if (!idempotency.ok) return idempotency.response
    const idempotencyKey = idempotency.key

    const admin = createSupabaseAdminClient()

    const existingByKey = await loadTransferByKey(admin, business.id, idempotencyKey)
    if (existingByKey) {
      return NextResponse.json(
        transferResponse(existingByKey, "This Paystack transfer request was already received.", {
          reused: true,
        })
      )
    }

    const subscriptionRow = await loadBusinessSubscriptionRow(supabase, business.id)
    const entitlement = resolveServiceEntitlement(subscriptionRow)

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

    const destination = resolvePaystackDestination({
      businessId: business.id,
      staffId: ctx.item.staff_id,
      destination: ctx.item,
    })

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

    if (!eligibility.ok || !destination.ok || !ctx.connection) {
      return NextResponse.json(
        {
          error: destination.ok ? eligibility.message : destination.message,
          code: destination.ok ? eligibility.code : destination.code,
          transfer_id: eligibility.transfer_id ?? ctx.activeTransfer?.id ?? null,
          balance: {
            ghs: pesewasToGhs(ctx.balancePesewas),
            pesewas: ctx.balancePesewas,
          },
        },
        { status: 409 }
      )
    }

    const active = await loadActiveTransferForItem(admin, business.id, ctx.item.id)
    if (active) {
      return NextResponse.json(
        transferResponse(active, "A Paystack transfer is already in progress for this employee."),
        { status: 409 }
      )
    }

    const amountPesewas = ghsToPesewas(ctx.item.amount)
    if (amountPesewas == null || amountPesewas <= 0) {
      return NextResponse.json({ error: "Invalid salary amount.", code: "AMOUNT_INVALID" }, { status: 400 })
    }

    let recipientCode: string | null = null
    const { data: matchingMethod } = await admin
      .from("staff_payment_methods")
      .select("*")
      .eq("business_id", business.id)
      .eq("staff_id", ctx.item.staff_id)
      .eq("paystack_recipient_fingerprint", destination.fingerprint)
      .eq("paystack_recipient_environment", ctx.connection.row.environment)
      .is("deleted_at", null)
      .not("paystack_recipient_code", "is", null)
      .maybeSingle()

    if (matchingMethod?.paystack_recipient_code) {
      recipientCode = String(matchingMethod.paystack_recipient_code)
    } else {
      const recipient = await createPaystackRecipient(
        ctx.connection.secretKey,
        buildPaystackRecipientInput(destination)
      )
      if (!recipient.ok) {
        return NextResponse.json(
          {
            error: safePaystackPayrollMessage(recipient.error),
            code: "PAYSTACK_RECIPIENT_FAILED",
          },
          { status: 400 }
        )
      }
      recipientCode = recipient.data.recipient_code

      // Associate the recipient with the current default method only when it
      // describes the same frozen destination. Never overwrite destinations.
      const { data: defaultMethod } = await admin
        .from("staff_payment_methods")
        .select("*")
        .eq("business_id", business.id)
        .eq("staff_id", ctx.item.staff_id)
        .eq("is_default", true)
        .is("deleted_at", null)
        .maybeSingle()

      if (defaultMethod) {
        const currentDestination = resolvePaystackDestination({
          businessId: business.id,
          staffId: ctx.item.staff_id,
          destination: defaultMethod,
        })
        if (currentDestination.ok && currentDestination.fingerprint === destination.fingerprint) {
          await admin
            .from("staff_payment_methods")
            .update({
              paystack_recipient_code: recipientCode,
              paystack_recipient_environment: ctx.connection.row.environment,
              paystack_recipient_fingerprint: destination.fingerprint,
              paystack_recipient_created_at: new Date().toISOString(),
            })
            .eq("id", defaultMethod.id)
            .eq("business_id", business.id)
        }
      }
    }

    const reference = `finza-ps-${randomUUID().replace(/-/g, "")}`
    const storedDestination = destinationForStorage(destination)
    const { data: inserted, error: insertError } = await admin
      .from("payroll_paystack_transfers")
      .insert({
        business_id: business.id,
        payroll_run_id: runId,
        batch_id: batchId,
        batch_item_id: itemId,
        staff_id: ctx.item.staff_id,
        payroll_entry_id: ctx.item.payroll_entry_id,
        amount: ctx.item.amount,
        currency: "GHS",
        environment: ctx.connection.row.environment,
        reference,
        idempotency_key: idempotencyKey,
        recipient_code: recipientCode,
        recipient_fingerprint: destination.fingerprint,
        ...storedDestination,
        status: "initiating",
        initiated_by: user.id,
      })
      .select("*")
      .single()

    if (insertError || !inserted) {
      const code = (insertError as { code?: string } | null)?.code
      const raced =
        (await loadTransferByKey(admin, business.id, idempotencyKey)) ??
        (await loadActiveTransferForItem(admin, business.id, itemId))
      if (raced) {
        return NextResponse.json(
          transferResponse(raced, "A Paystack transfer request already exists for this employee."),
          { status: 409 }
        )
      }
      console.error("[paystack pay] insert attempt", code)
      return NextResponse.json(
        { error: "Could not create the Paystack transfer attempt.", code: "TRANSFER_ATTEMPT_FAILED" },
        { status: 500 }
      )
    }

    attemptForFailure = { admin, id: String(inserted.id) }
    const transfer = inserted as TransferRow

    const initiated = await initiatePaystackTransfer(ctx.connection.secretKey, {
      source: "balance",
      amount: amountPesewas,
      recipient: recipientCode!,
      reason: `Finza salary - ${ctx.item.employee_name || "employee"}`,
      reference,
      currency: "GHS",
    })

    if (!initiated.ok) {
      const uncertain =
        initiated.code === "PAYSTACK_TIMEOUT" || initiated.code === "PAYSTACK_NETWORK_ERROR"
      if (uncertain) {
        await admin
          .from("payroll_paystack_transfers")
          .update({
            status: "requires_attention",
            requires_attention_reason:
              "Paystack did not confirm whether the transfer was created. Verify the transfer before retrying.",
          })
          .eq("id", transfer.id)
        return NextResponse.json(
          {
            ...transferResponse(transfer, "Paystack did not confirm the transfer. Verify before retrying."),
            status: "requires_attention",
            code: "PAYSTACK_UNCERTAIN",
          },
          { status: 202 }
        )
      }

      await admin
        .from("payroll_paystack_transfers")
        .update({
          status: "failed",
          failure_reason: safePaystackPayrollMessage(initiated.error),
        })
        .eq("id", transfer.id)

      return NextResponse.json(
        {
          ...transferResponse(transfer, safePaystackPayrollMessage(initiated.error)),
          status: "failed",
          code: initiated.code ?? "PAYSTACK_TRANSFER_FAILED",
        },
        { status: initiated.httpStatus === 401 ? 400 : 402 }
      )
    }

    const initiationData = initiated.data
    const initiatedStatus = String(initiationData.status ?? "").toLowerCase()

    let providerData = initiationData
    if (["success", "successful", "pending", "processing", "queued"].includes(initiatedStatus)) {
      const verified = await verifyPaystackTransfer(ctx.connection.secretKey, reference)
      if (verified.ok) {
        providerData = verified.data
      } else if (["success", "successful"].includes(initiatedStatus)) {
        await admin
          .from("payroll_paystack_transfers")
          .update({
            status: "requires_attention",
            provider_status: initiationData.status ?? null,
            provider_transfer_id:
              initiationData.id != null ? String(initiationData.id) : null,
            provider_transfer_code:
              initiationData.transfer_code != null ? String(initiationData.transfer_code) : null,
            requires_attention_reason:
              "Paystack initiation returned success but the transfer could not be verified. Do not retry; verify first.",
          })
          .eq("id", transfer.id)
        return NextResponse.json(
          {
            ...transferResponse(
              transfer,
              "Paystack accepted the request but the final status could not be verified. Verify before retrying."
            ),
            status: "requires_attention",
            code: "PAYSTACK_VERIFICATION_REQUIRED",
          },
          { status: 202 }
        )
      }
    }

    const outcome = await processPaystackTransferProviderResult({
      admin,
      transfer,
      providerData,
      source: "initiation",
    })

    const statusCode =
      outcome.status === "successful"
        ? 201
        : outcome.status === "failed"
          ? 402
          : outcome.status === "requires_attention"
            ? 202
            : 202

    return NextResponse.json(
      transferResponse(outcome.transfer ?? transfer, outcome.message, {
        status: outcome.status,
        otp_required: outcome.status === "awaiting_authorization",
        amount: ctx.item.amount,
        currency: "GHS",
        employee_name: ctx.item.employee_name,
      }),
      { status: statusCode }
    )
  } catch (error: unknown) {
    console.error("[paystack pay]", error)
    if (attemptForFailure) {
      await attemptForFailure.admin
        .from("payroll_paystack_transfers")
        .update({
          status: "requires_attention",
          requires_attention_reason:
            "Unexpected error after initiating the transfer. Verify with Paystack before retrying.",
        })
        .eq("id", attemptForFailure.id)
        .then(() => undefined)
    }
    return NextResponse.json(
      {
        error:
          "The Paystack transfer outcome is uncertain. Verify the transfer before retrying.",
        code: "PAYSTACK_UNCERTAIN",
      },
      { status: 202 }
    )
  }
}
