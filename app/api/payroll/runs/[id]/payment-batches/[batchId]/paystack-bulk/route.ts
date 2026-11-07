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
  initiatePaystackBulkTransfer,
  safePaystackPayrollMessage,
  verifyPaystackTransfer,
} from "@/lib/payroll/paystack/paystackClient"
import { ghsToPesewas, pesewasToGhs } from "@/lib/payroll/paystack/amounts"
import { isPaystackLiveTransfersEnabled } from "@/lib/payroll/paystack/connection"
import { loadPaystackPaymentContext } from "@/lib/payroll/paystack/paymentContext"
import { processPaystackTransferProviderResult } from "@/lib/payroll/paystack/transferProcessor"
import { resolvePayrollIdempotencyKey } from "@/lib/payroll/resolvePayrollIdempotencyKey"

type TransferAttempt = {
  itemId: string
  transferId: string
  reference: string
  recipientCode: string
  amountPesewas: number
  employeeName: string | null
}

function bulkItemIdempotencyKey(bulkKey: string, itemId: string): string {
  return `bulk:${bulkKey.slice(0, 80)}:${itemId}`
}

function providerReference(row: Record<string, unknown>): string {
  const value = row.reference
  return value == null ? "" : String(value).trim()
}

function providerStatus(row: Record<string, unknown>): string {
  const value = row.status
  return value == null ? "" : String(value).trim().toLowerCase()
}

async function ensureBulkRecipient(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>
  businessId: string
  staffId: string
  environment: "test" | "live"
  destination: ReturnType<typeof resolvePaystackDestination>
}): Promise<{ ok: true; recipientCode: string } | { ok: false; message: string }> {
  if (!input.destination.ok) return { ok: false, message: input.destination.message }

  const destination = input.destination
  const { data: matchingMethod } = await input.admin
    .from("staff_payment_methods")
    .select("*")
    .eq("business_id", input.businessId)
    .eq("staff_id", input.staffId)
    .eq("paystack_recipient_fingerprint", destination.fingerprint)
    .eq("paystack_recipient_environment", input.environment)
    .is("deleted_at", null)
    .not("paystack_recipient_code", "is", null)
    .maybeSingle()

  if (matchingMethod?.paystack_recipient_code) {
    return { ok: true, recipientCode: String(matchingMethod.paystack_recipient_code) }
  }

  return { ok: false, message: "recipient_missing" }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; batchId: string }> | { id: string; batchId: string } }
) {
  let insertedAttempts: TransferAttempt[] = []
  try {
    const { id: runId, batchId } = await Promise.resolve(params)
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
          error: "Explicit confirmation is required before bulk salary transfers can be initiated.",
          code: "PAYSTACK_CONFIRMATION_REQUIRED",
        },
        { status: 400 }
      )
    }

    const rawItemIds = Array.isArray(body.item_ids) ? body.item_ids : []
    const itemIds = [...new Set(rawItemIds.filter((id: unknown) => typeof id === "string" && id.trim()))] as string[]
    if (itemIds.length === 0) {
      return NextResponse.json({ error: "Select at least one employee.", code: "NO_ITEMS_SELECTED" }, { status: 400 })
    }
    if (itemIds.length > 100) {
      return NextResponse.json({ error: "Select no more than 100 employees per bulk payment.", code: "TOO_MANY_ITEMS" }, { status: 400 })
    }

    const idempotency = resolvePayrollIdempotencyKey(request, body)
    if (!idempotency.ok) return idempotency.response
    const bulkKey = idempotency.key

    const admin = createSupabaseAdminClient()
    const subscriptionRow = await loadBusinessSubscriptionRow(supabase, business.id)
    const entitlement = resolveServiceEntitlement(subscriptionRow)

    const contexts = []
    for (const itemId of itemIds) {
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
      contexts.push(ctx)
    }

    const itemKeys = new Map(itemIds.map((itemId) => [itemId, bulkItemIdempotencyKey(bulkKey, itemId)]))
    const { data: existingTransfers } = await admin
      .from("payroll_paystack_transfers")
      .select("id,status,reference,batch_item_id,idempotency_key,payment_id")
      .eq("business_id", business.id)
      .in("idempotency_key", [...itemKeys.values()])

    if (existingTransfers && existingTransfers.length > 0) {
      if (existingTransfers.length === itemIds.length) {
        return NextResponse.json({
          success: true,
          reused: true,
          results: existingTransfers.map((transfer) => ({
            item_id: transfer.batch_item_id,
            transfer_id: transfer.id,
            reference: transfer.reference,
            status: transfer.status,
            message: "This bulk request was already received.",
          })),
        })
      }
      return NextResponse.json(
        {
          error: "This bulk request was partially processed. Refresh the batch before retrying.",
          code: "PAYSTACK_BULK_PARTIAL_RETRY",
        },
        { status: 409 }
      )
    }

    const connection = contexts[0]?.connection
    if (!connection?.secretKey || !connection.row.is_active || connection.row.status !== "connected") {
      return NextResponse.json(
        { error: "Paystack connection is not active. Reconnect before paying employees.", code: "PAYSTACK_NOT_CONNECTED" },
        { status: 409 }
      )
    }

    const availableBalances = contexts
      .map((ctx) => ctx.balancePesewas)
      .filter((value): value is number => value != null)
    const availableBalance = availableBalances.length ? Math.min(...availableBalances) : null
    let totalPesewas = 0

    for (const ctx of contexts) {
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

      if (!destination.ok) {
        return NextResponse.json(
          { error: `${ctx.item.employee_name || "Employee"}: ${destination.message}`, code: destination.code },
          { status: 409 }
        )
      }
      if (!eligibility.ok) {
        return NextResponse.json(
          {
            error: `${ctx.item.employee_name || "Employee"}: ${eligibility.message}`,
            code: eligibility.code,
            transfer_id: eligibility.transfer_id ?? null,
          },
          { status: 409 }
        )
      }

      const amountPesewas = ghsToPesewas(ctx.item.amount)
      if (amountPesewas == null || amountPesewas <= 0) {
        return NextResponse.json(
          { error: `${ctx.item.employee_name || "Employee"} has an invalid salary amount.`, code: "AMOUNT_INVALID" },
          { status: 400 }
        )
      }
      totalPesewas += amountPesewas
    }

    if (availableBalance != null && totalPesewas > availableBalance + 0.005) {
      return NextResponse.json(
        {
          error: `Paystack balance is GH₵${pesewasToGhs(availableBalance).toFixed(2)} but the selected salaries total GH₵${pesewasToGhs(totalPesewas).toFixed(2)}. Fund the Paystack balance and try again.`,
          code: "PAYSTACK_BALANCE_INSUFFICIENT",
        },
        { status: 409 }
      )
    }

    // Resolve/create recipients before writing transfer rows. A failure here
    // leaves the batch untouched and still allows individual payments.
    const prepared: Array<{
      ctx: (typeof contexts)[number]
      destination: ReturnType<typeof resolvePaystackDestination>
      recipientCode: string
      amountPesewas: number
    }> = []

    for (const ctx of contexts) {
      const destination = resolvePaystackDestination({
        businessId: business.id,
        staffId: ctx.item.staff_id,
        destination: ctx.item,
      })
      if (!destination.ok) {
        return NextResponse.json({ error: destination.message, code: destination.code }, { status: 409 })
      }

      const cached = await ensureBulkRecipient({
        admin,
        businessId: business.id,
        staffId: ctx.item.staff_id,
        environment: connection.row.environment,
        destination,
      })

      let recipientCode = cached.ok ? cached.recipientCode : null
      if (!recipientCode) {
        const recipient = await createPaystackRecipient(
          connection.secretKey,
          buildPaystackRecipientInput(destination)
        )
        if (!recipient.ok) {
          return NextResponse.json(
            {
              error: `${ctx.item.employee_name || "Employee"}: ${safePaystackPayrollMessage(recipient.error)}`,
              code: "PAYSTACK_RECIPIENT_FAILED",
            },
            { status: 400 }
          )
        }
        recipientCode = recipient.data.recipient_code

        const { data: defaultMethod } = await admin
          .from("staff_payment_methods")
          .select("*")
          .eq("business_id", business.id)
          .eq("staff_id", ctx.item.staff_id)
          .eq("is_default", true)
          .is("deleted_at", null)
          .maybeSingle()

        if (defaultMethod) {
          const current = resolvePaystackDestination({
            businessId: business.id,
            staffId: ctx.item.staff_id,
            destination: defaultMethod,
          })
          if (current.ok && current.fingerprint === destination.fingerprint) {
            await admin
              .from("staff_payment_methods")
              .update({
                paystack_recipient_code: recipientCode,
                paystack_recipient_environment: connection.row.environment,
                paystack_recipient_fingerprint: destination.fingerprint,
                paystack_recipient_created_at: new Date().toISOString(),
              })
              .eq("id", defaultMethod.id)
              .eq("business_id", business.id)
          }
        }
      }

      const amountPesewas = ghsToPesewas(ctx.item.amount)
      if (amountPesewas == null || amountPesewas <= 0) {
        return NextResponse.json({ error: "Invalid salary amount.", code: "AMOUNT_INVALID" }, { status: 400 })
      }
      prepared.push({ ctx, destination, recipientCode, amountPesewas })
    }

    for (const entry of prepared) {
      const reference = `finza-ps-${randomUUID().replace(/-/g, "")}`
      const itemKey = itemKeys.get(entry.ctx.item.id)!
      const { data: inserted, error: insertError } = await admin
        .from("payroll_paystack_transfers")
        .insert({
          business_id: business.id,
          payroll_run_id: runId,
          batch_id: batchId,
          batch_item_id: entry.ctx.item.id,
          staff_id: entry.ctx.item.staff_id,
          payroll_entry_id: entry.ctx.item.payroll_entry_id,
          amount: entry.ctx.item.amount,
          currency: "GHS",
          environment: connection.row.environment,
          reference,
          idempotency_key: itemKey,
          recipient_code: entry.recipientCode,
          recipient_fingerprint: entry.destination.ok ? entry.destination.fingerprint : null,
          ...destinationForStorage(
            entry.destination as Extract<ReturnType<typeof resolvePaystackDestination>, { ok: true }>
          ),
          status: "initiating",
          initiated_by: user.id,
        })
        .select("id")
        .single()

      if (insertError || !inserted) {
        await Promise.all(
          insertedAttempts.map((attempt) =>
            admin
              .from("payroll_paystack_transfers")
              .update({
                status: "failed",
                failure_reason: "Bulk transfer was not submitted because another selected employee conflicted.",
              })
              .eq("id", attempt.transferId)
          )
        )
        return NextResponse.json(
          { error: "A transfer request already exists for one of the selected employees. Refresh the batch.", code: "PAYSTACK_BULK_CONFLICT" },
          { status: 409 }
        )
      }

      insertedAttempts.push({
        itemId: entry.ctx.item.id,
        transferId: String(inserted.id),
        reference,
        recipientCode: entry.recipientCode,
        amountPesewas: entry.amountPesewas,
        employeeName: entry.ctx.item.employee_name,
      })
    }

    const initiated = await initiatePaystackBulkTransfer(connection.secretKey, {
      source: "balance",
      currency: "GHS",
      transfers: insertedAttempts.map((attempt) => ({
        amount: attempt.amountPesewas,
        recipient: attempt.recipientCode,
        reason: `Finza salary - ${attempt.employeeName || "employee"}`,
        reference: attempt.reference,
      })),
    })

    if (!initiated.ok) {
      const uncertain =
        initiated.code === "PAYSTACK_TIMEOUT" || initiated.code === "PAYSTACK_NETWORK_ERROR"
      const unavailable = /otp|bulk.*(not|disabled|unavailable|enable)|transfer.*otp/i.test(initiated.error)
      const status = uncertain ? "requires_attention" : "failed"
      const reason = uncertain
        ? "Paystack did not confirm whether the bulk transfer was created. Verify each transfer before retrying."
        : unavailable
          ? "Paystack bulk transfers are unavailable for this account. Disable Transfers OTP in Paystack or pay employees individually."
          : safePaystackPayrollMessage(initiated.error)

      await Promise.all(
        insertedAttempts.map((attempt) =>
          admin
            .from("payroll_paystack_transfers")
            .update({
              status,
              failure_reason: uncertain ? null : reason,
              requires_attention_reason: uncertain ? reason : null,
            })
            .eq("id", attempt.transferId)
        )
      )

      return NextResponse.json(
        {
          error: reason,
          code: uncertain
            ? "PAYSTACK_BULK_UNCERTAIN"
            : unavailable
              ? "PAYSTACK_BULK_UNAVAILABLE"
              : (initiated.code ?? "PAYSTACK_BULK_FAILED"),
          bulk_unavailable: unavailable,
        },
        { status: uncertain ? 202 : unavailable ? 409 : 402 }
      )
    }

    const byReference = new Map<string, Record<string, unknown>>()
    for (const row of initiated.data) {
      const reference = providerReference(row)
      if (reference) byReference.set(reference, row)
    }

    const results: Array<{
      item_id: string
      transfer_id: string
      reference: string
      status: string
      message?: string
    }> = []

    for (const attempt of insertedAttempts) {
      const row = byReference.get(attempt.reference)
      if (!row) {
        await admin
          .from("payroll_paystack_transfers")
          .update({
            status: "requires_attention",
            requires_attention_reason:
              "Paystack bulk response did not include this employee. Verify the transfer before retrying.",
          })
          .eq("id", attempt.transferId)
        results.push({
          item_id: attempt.itemId,
          transfer_id: attempt.transferId,
          reference: attempt.reference,
          status: "requires_attention",
          message: "Bulk response missing this employee.",
        })
        continue
      }

      let providerData = row
      const rowStatus = providerStatus(row)
      if (["success", "successful", "pending", "processing", "queued"].includes(rowStatus)) {
        const verified = await verifyPaystackTransfer(connection.secretKey, attempt.reference)
        if (verified.ok) {
          providerData = verified.data
        } else if (["success", "successful"].includes(rowStatus)) {
          await admin
            .from("payroll_paystack_transfers")
            .update({
              status: "requires_attention",
              provider_status: row.status ?? null,
              provider_transfer_code: row.transfer_code != null ? String(row.transfer_code) : null,
              requires_attention_reason:
                "Paystack bulk transfer returned success but the transfer could not be verified. Do not retry; verify first.",
            })
            .eq("id", attempt.transferId)
          results.push({
            item_id: attempt.itemId,
            transfer_id: attempt.transferId,
            reference: attempt.reference,
            status: "requires_attention",
            message: "Bulk transfer could not be verified.",
          })
          continue
        }
      }

      const { data: transferRow } = await admin
        .from("payroll_paystack_transfers")
        .select("*")
        .eq("id", attempt.transferId)
        .single()

      if (!transferRow) {
        results.push({
          item_id: attempt.itemId,
          transfer_id: attempt.transferId,
          reference: attempt.reference,
          status: "requires_attention",
          message: "Transfer record missing.",
        })
        continue
      }

      const outcome = await processPaystackTransferProviderResult({
        admin,
        transfer: transferRow as Parameters<typeof processPaystackTransferProviderResult>[0]["transfer"],
        providerData,
        source: "initiation",
      })
      results.push({
        item_id: attempt.itemId,
        transfer_id: attempt.transferId,
        reference: attempt.reference,
        status: outcome.status,
        message: outcome.message,
      })
    }

    return NextResponse.json({
      success: true,
      bulk: true,
      results,
      paid: results.filter((result) => result.status === "successful").length,
      processing: results.filter((result) => ["pending", "awaiting_authorization"].includes(result.status)).length,
      requires_attention: results.filter((result) => result.status === "requires_attention").length,
      failed: results.filter((result) => result.status === "failed").length,
    })
  } catch (error: unknown) {
    console.error("[paystack bulk]", error)
    if (insertedAttempts.length > 0) {
      await createSupabaseAdminClient()
        .from("payroll_paystack_transfers")
        .update({
          status: "requires_attention",
          requires_attention_reason:
            "Unexpected error after submitting the bulk transfer. Verify each employee transfer before retrying.",
        })
        .in("id", insertedAttempts.map((attempt) => attempt.transferId))
        .then(() => undefined)
    }
    return NextResponse.json(
      {
        error: "The Paystack bulk transfer outcome is uncertain. Verify the selected transfers before retrying.",
        code: "PAYSTACK_BULK_UNCERTAIN",
      },
      { status: 202 }
    )
  }
}
