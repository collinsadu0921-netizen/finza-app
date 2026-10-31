import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  normalizePaystackTransferStatus,
  paystackFeeFromTransfer,
  paystackTransferAmountPesewas,
  paystackTransferCurrency,
  paystackTransferReference,
  safePaystackPayrollMessage,
} from "./paystackClient"

export type PayrollPaystackTransferRow = {
  id: string
  business_id: string
  payroll_run_id: string
  batch_id: string
  batch_item_id: string
  staff_id: string
  payroll_entry_id: string
  amount: number | string
  currency: string
  environment: "test" | "live"
  reference: string
  status: string
  provider_status: string | null
  provider_transfer_id: string | null
  provider_transfer_code: string | null
  payment_id: string | null
  fee_amount: number | string | null
  initiated_by: string | null
}

export type TransferProcessingOutcome = {
  applied: boolean
  status: string
  message: string
  transfer: PayrollPaystackTransferRow | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

async function reloadTransfer(
  admin: SupabaseClient,
  transferId: string
): Promise<PayrollPaystackTransferRow | null> {
  const { data } = await admin
    .from("payroll_paystack_transfers")
    .select("*")
    .eq("id", transferId)
    .maybeSingle()
  return (data as PayrollPaystackTransferRow | null) ?? null
}

function providerField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key]
  return value == null ? null : String(value).trim() || null
}

/**
 * Applies a provider response/webhook result to a stored transfer attempt.
 * The external HTTP status is never trusted by itself: success is settled only
 * after a verified Paystack transfer identity, amount and currency match.
 */
export async function processPaystackTransferProviderResult(input: {
  admin: SupabaseClient
  transfer: PayrollPaystackTransferRow
  providerData: Record<string, unknown>
  source: "initiation" | "verification" | "webhook"
  refundFee?: boolean
}): Promise<TransferProcessingOutcome> {
  const { admin, transfer, providerData, source } = input
  const rawStatus = providerField(providerData, "status")
  const normalized = normalizePaystackTransferStatus(rawStatus)
  const providerTransferId = providerField(providerData, "id") ?? providerField(providerData, "transfer_id")
  const providerTransferCode = providerField(providerData, "transfer_code")
  const providerReference = paystackTransferReference(providerData)
  const amountPesewas = paystackTransferAmountPesewas(providerData)
  const currency = paystackTransferCurrency(providerData)
  const feePesewas = paystackFeeFromTransfer(providerData)
  const paidAt =
    providerField(providerData, "transferred_at") ??
    providerField(providerData, "updatedAt") ??
    new Date().toISOString()

  if (transfer.status === "successful" || transfer.status === "reversed") {
    if (normalized === "reversed" && transfer.status === "successful") {
      // fall through to controlled reversal
    } else if (normalized === "successful" || normalized === "pending" || normalized === "failed") {
      return {
        applied: false,
        status: transfer.status,
        message: "Transfer already has a final status.",
        transfer: await reloadTransfer(admin, transfer.id),
      }
    }
  }

  if (normalized === "successful") {
    if (providerReference && providerReference !== transfer.reference) {
      await admin
        .from("payroll_paystack_transfers")
        .update({
          status: "requires_attention",
          provider_status: rawStatus,
          requires_attention_reason: "Paystack reference does not match the stored transfer reference.",
        })
        .eq("id", transfer.id)
      return {
        applied: true,
        status: "requires_attention",
        message: "Paystack returned a different transfer reference. This transfer requires review.",
        transfer: await reloadTransfer(admin, transfer.id),
      }
    }

    const expectedPesewas = Math.round(Number(transfer.amount) * 100)
    if (amountPesewas == null || amountPesewas !== expectedPesewas || currency !== transfer.currency) {
      await admin
        .from("payroll_paystack_transfers")
        .update({
          status: "requires_attention",
          provider_status: rawStatus,
          requires_attention_reason: "Paystack amount or currency did not match the frozen salary transfer.",
        })
        .eq("id", transfer.id)
      return {
        applied: true,
        status: "requires_attention",
        message: "Paystack returned a mismatched amount or currency. This transfer requires review.",
        transfer: await reloadTransfer(admin, transfer.id),
      }
    }

    const { data, error } = await admin.rpc("settle_payroll_paystack_transfer_atomic", {
      p_transfer_id: transfer.id,
      p_provider_status: rawStatus ?? "success",
      p_provider_transfer_id: providerTransferId,
      p_provider_transfer_code: providerTransferCode,
      p_paid_at: paidAt,
      p_fee_pesewas: feePesewas,
    })

    if (error) {
      await admin
        .from("payroll_paystack_transfers")
        .update({
          status: "requires_attention",
          provider_status: rawStatus,
          provider_transfer_id: providerTransferId,
          provider_transfer_code: providerTransferCode,
          requires_attention_reason:
            "Paystack confirmed the transfer but salary settlement failed. Do not retry; review the transfer.",
        })
        .eq("id", transfer.id)
      console.error("[paystack transfer] settlement failed", { transferId: transfer.id, code: error.code })
      return {
        applied: false,
        status: "requires_attention",
        message:
          "Paystack confirmed this transfer, but Finza could not post the salary settlement. It requires review and must not be retried.",
        transfer: await reloadTransfer(admin, transfer.id),
      }
    }

    return {
      applied: true,
      status: "successful",
      message: "Salary transfer confirmed and settled.",
      transfer: await reloadTransfer(admin, transfer.id),
      ...(asRecord(data) ? { settlement: data } : {}),
    } as TransferProcessingOutcome
  }

  if (normalized === "reversed") {
    if (transfer.status === "successful" && transfer.payment_id) {
      const { error } = await admin.rpc("reverse_payroll_paystack_transfer_atomic", {
        p_transfer_id: transfer.id,
        p_reason: "Paystack reported a reversed salary transfer.",
        p_provider_status: rawStatus,
        p_refund_fee: Boolean(input.refundFee),
      })
      if (error) {
        await admin
          .from("payroll_paystack_transfers")
          .update({
            status: "requires_attention",
            provider_status: rawStatus,
            requires_attention_reason:
              "Paystack reversed the transfer but the salary reversal failed. Review the accounting entries.",
          })
          .eq("id", transfer.id)
        return {
          applied: false,
          status: "requires_attention",
          message:
            "Paystack reversed this transfer, but Finza could not reverse the salary settlement. It requires review.",
          transfer: await reloadTransfer(admin, transfer.id),
        }
      }
    } else {
      await admin
        .from("payroll_paystack_transfers")
        .update({
          status: "reversed",
          provider_status: rawStatus,
          provider_transfer_id: providerTransferId,
          provider_transfer_code: providerTransferCode,
          reversed_at: new Date().toISOString(),
        })
        .eq("id", transfer.id)
    }
    return {
      applied: true,
      status: "reversed",
      message: "The salary transfer was reversed. The employee salary is outstanding again.",
      transfer: await reloadTransfer(admin, transfer.id),
    }
  }

  if (normalized === "failed") {
    await admin
      .from("payroll_paystack_transfers")
      .update({
        status: "failed",
        provider_status: rawStatus,
        provider_transfer_id: providerTransferId,
        provider_transfer_code: providerTransferCode,
        failure_reason: safePaystackPayrollMessage(providerField(providerData, "gateway_response")),
        requires_attention_reason: null,
      })
      .eq("id", transfer.id)
    return {
      applied: true,
      status: "failed",
      message: "Paystack could not complete this salary transfer. The employee salary remains outstanding.",
      transfer: await reloadTransfer(admin, transfer.id),
    }
  }

  if (normalized === "awaiting_authorization" || normalized === "pending") {
    await admin
      .from("payroll_paystack_transfers")
      .update({
        status: normalized,
        provider_status: rawStatus,
        provider_transfer_id: providerTransferId,
        provider_transfer_code: providerTransferCode,
      })
      .eq("id", transfer.id)
    return {
      applied: true,
      status: normalized,
      message:
        normalized === "awaiting_authorization"
          ? "Paystack requires authorization before this transfer can complete."
          : "Paystack is processing this transfer. The employee is not yet shown as paid.",
      transfer: await reloadTransfer(admin, transfer.id),
    }
  }

  await admin
    .from("payroll_paystack_transfers")
    .update({
      status: "requires_attention",
      provider_status: rawStatus,
      provider_transfer_id: providerTransferId,
      provider_transfer_code: providerTransferCode,
      requires_attention_reason: `Unrecognized Paystack transfer status: ${rawStatus ?? "missing"}`,
    })
    .eq("id", transfer.id)

  return {
    applied: true,
    status: "requires_attention",
    message:
      "Paystack returned an uncertain transfer status. Do not retry; verify the transfer before taking further action.",
    transfer: await reloadTransfer(admin, transfer.id),
    source,
  } as TransferProcessingOutcome
}
