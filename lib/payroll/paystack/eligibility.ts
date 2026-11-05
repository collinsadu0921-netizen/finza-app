import { ghsToPesewas } from "./amounts"

export type PaystackEligibilityCode =
  | "OK"
  | "TIER_REQUIRED"
  | "PERMISSION_DENIED"
  | "RUN_NOT_PAYABLE"
  | "BATCH_NOT_PAYABLE"
  | "ITEM_NOT_PAYABLE"
  | "ALREADY_PAID"
  | "AMOUNT_INVALID"
  | "AMOUNT_MISMATCH"
  | "CURRENCY_UNSUPPORTED"
  | "DESTINATION_MISSING"
  | "AGGREGATE_CONFLICT"
  | "TRANSFER_PENDING"
  | "CONNECTION_MISSING"
  | "CONNECTION_INACTIVE"
  | "CONNECTION_ENVIRONMENT_MISMATCH"
  | "LIVE_TRANSFERS_DISABLED"
  | "INSUFFICIENT_BALANCE"

export type PaystackEligibilityResult = {
  ok: boolean
  code: PaystackEligibilityCode
  message: string
  available_balance_pesewas?: number | null
  required_pesewas?: number | null
  transfer_id?: string | null
}

export type PaystackEligibilityInput = {
  tier: "starter" | "professional" | "business"
  business_tier_allows_paystack: boolean
  has_payroll_pay_permission: boolean
  run_status: string
  batch_status: string
  item_status: string
  item_payment_id: string | null
  item_amount: number | string | null
  item_currency: string | null
  transfer_amount?: number | string | null
  destination_valid: boolean
  has_unallocated_aggregate_payment: boolean
  connection: {
    exists: boolean
    is_active: boolean
    status: string
    environment: "test" | "live" | null
  }
  live_transfers_enabled: boolean
  expected_environment?: "test" | "live" | null
  available_balance_pesewas: number | null
  active_transfer?: { id: string; status: string; reference: string } | null
}

const PAYABLE_RUN_STATUSES = new Set(["approved", "locked"])

export function evaluatePaystackSalaryEligibility(
  input: PaystackEligibilityInput
): PaystackEligibilityResult {
  if (input.tier !== "business" || !input.business_tier_allows_paystack) {
    return {
      ok: false,
      code: "TIER_REQUIRED",
      message: "Paystack salary disbursements require the Business plan.",
    }
  }

  if (!input.has_payroll_pay_permission) {
    return {
      ok: false,
      code: "PERMISSION_DENIED",
      message: "You do not have permission to initiate salary payments.",
    }
  }

  if (!PAYABLE_RUN_STATUSES.has(String(input.run_status ?? "").toLowerCase())) {
    return {
      ok: false,
      code: "RUN_NOT_PAYABLE",
      message:
        input.run_status === "draft"
          ? "Approve this payroll before paying employees."
          : input.run_status === "reversed"
            ? "This payroll run was reversed and cannot be paid."
            : "This payroll run is not payable.",
    }
  }

  if (String(input.batch_status ?? "").toLowerCase() === "cancelled") {
    return {
      ok: false,
      code: "BATCH_NOT_PAYABLE",
      message: "This payment batch was cancelled. Create a new batch before paying.",
    }
  }

  if (input.item_payment_id || String(input.item_status ?? "").toLowerCase() === "paid") {
    return {
      ok: false,
      code: "ALREADY_PAID",
      message: "This employee salary has already been settled for this payroll run.",
    }
  }

  if (!["pending", "failed"].includes(String(input.item_status ?? "").toLowerCase())) {
    return {
      ok: false,
      code: "ITEM_NOT_PAYABLE",
      message: "This employee payment instruction is not currently payable.",
    }
  }

  const itemPesewas = ghsToPesewas(input.item_amount)
  if (itemPesewas == null || itemPesewas <= 0) {
    return {
      ok: false,
      code: "AMOUNT_INVALID",
      message: "This employee salary amount is invalid for a Paystack transfer.",
    }
  }

  if (input.transfer_amount != null) {
    const transferPesewas = ghsToPesewas(input.transfer_amount)
    if (transferPesewas == null || transferPesewas !== itemPesewas) {
      return {
        ok: false,
        code: "AMOUNT_MISMATCH",
        message: "The transfer amount does not match the frozen salary instruction.",
      }
    }
  }

  if (String(input.item_currency ?? "GHS").toUpperCase() !== "GHS") {
    return {
      ok: false,
      code: "CURRENCY_UNSUPPORTED",
      message: "Paystack salary transfers currently support GHS only.",
    }
  }

  if (!input.destination_valid) {
    return {
      ok: false,
      code: "DESTINATION_MISSING",
      message: "Add a valid bank or Mobile Money destination for this employee before paying.",
    }
  }

  if (input.has_unallocated_aggregate_payment) {
    return {
      ok: false,
      code: "AGGREGATE_CONFLICT",
      message:
        "This run has aggregate salary payments that are not allocated to employees. Reverse those aggregate payments before paying individually.",
    }
  }

  if (input.active_transfer) {
    const status = String(input.active_transfer.status ?? "").toLowerCase()
    if (["initiating", "awaiting_authorization", "pending", "successful"].includes(status)) {
      return {
        ok: false,
        code: "TRANSFER_PENDING",
        message:
          status === "successful"
            ? "A Paystack transfer has already been confirmed for this employee."
            : "A Paystack transfer is already in progress for this employee. Verify its status before starting another.",
        transfer_id: input.active_transfer.id,
      }
    }
  }

  if (!input.connection.exists || !input.connection.is_active || input.connection.status !== "connected") {
    return {
      ok: false,
      code: "CONNECTION_MISSING",
      message: "Connect your business Paystack account in Settings before paying salaries with Paystack.",
    }
  }

  if (input.connection.environment === "live" && !input.live_transfers_enabled) {
    return {
      ok: false,
      code: "LIVE_TRANSFERS_DISABLED",
      message: "Live Paystack salary transfers are not enabled. Use a Paystack test connection for staging verification.",
    }
  }

  if (
    input.expected_environment &&
    input.connection.environment !== input.expected_environment
  ) {
    return {
      ok: false,
      code: "CONNECTION_ENVIRONMENT_MISMATCH",
      message: "The Paystack connection environment does not match this transfer attempt.",
    }
  }

  if (input.available_balance_pesewas == null) {
    return {
      ok: false,
      code: "CONNECTION_INACTIVE",
      message: "Could not read the available Paystack GHS balance. Reconnect or verify your Paystack key.",
    }
  }

  if (input.available_balance_pesewas < itemPesewas) {
    return {
      ok: false,
      code: "INSUFFICIENT_BALANCE",
      message: "Your Paystack GHS balance is too low for this salary. Fund the Paystack balance and try again.",
      available_balance_pesewas: input.available_balance_pesewas,
      required_pesewas: itemPesewas,
    }
  }

  return {
    ok: true,
    code: "OK",
    message: "Ready to pay with Paystack.",
    available_balance_pesewas: input.available_balance_pesewas,
    required_pesewas: itemPesewas,
  }
}
