import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

function mapObligationPaymentError(message: string): { status: number; code: string; error: string } {
  const text = String(message || "")
  if (text.includes("PAYROLL_OBLIGATION_PAYMENT_PERMISSION_DENIED")) {
    return { status: 403, code: "PAYROLL_OBLIGATION_PAYMENT_PERMISSION_DENIED", error: "You do not have permission to record this payroll payment." }
  }
  if (text.includes("PAYROLL_OBLIGATION_PAYMENT_NOT_FOUND")) {
    return { status: 404, code: "PAYROLL_OBLIGATION_PAYMENT_NOT_FOUND", error: "Payroll obligation not found." }
  }
  if (text.includes("PAYROLL_OBLIGATION_PAYMENT_OBLIGATION_REVERSED")) {
    return { status: 409, code: "PAYROLL_OBLIGATION_PAYMENT_OBLIGATION_REVERSED", error: "Reversed payroll obligations cannot accept payments." }
  }
  if (text.includes("PAYROLL_OBLIGATION_PAYMENT_IDEMPOTENCY_CONFLICT")) {
    return { status: 409, code: "PAYROLL_OBLIGATION_PAYMENT_IDEMPOTENCY_CONFLICT", error: "This payment request was already used with different details." }
  }
  if (text.includes("PAYROLL_OBLIGATION_PAYMENT_ALREADY_PAID")) {
    return { status: 400, code: "PAYROLL_OBLIGATION_PAYMENT_ALREADY_PAID", error: "This payroll obligation has no outstanding balance." }
  }
  if (text.includes("PAYROLL_OBLIGATION_PAYMENT_EXCEEDS_OUTSTANDING")) {
    return { status: 400, code: "PAYROLL_OBLIGATION_PAYMENT_EXCEEDS_OUTSTANDING", error: "Payment amount exceeds the outstanding obligation." }
  }
  if (text.includes("PAYROLL_OBLIGATION_PAYMENT_SALARY_NET_REQUIRES_SALARY_PAYMENT")) {
    return { status: 400, code: "PAYROLL_OBLIGATION_PAYMENT_SALARY_NET_REQUIRES_SALARY_PAYMENT", error: "Net salary must be paid through the salary payment action." }
  }
  if (
    text.includes("PAYROLL_OBLIGATION_PAYMENT_INVALID_INPUT") ||
    text.includes("PAYROLL_OBLIGATION_PAYMENT_RUN_NOT_PAYABLE") ||
    text.includes("PAYROLL_OBLIGATION_PAYMENT_INVALID_ACCOUNT") ||
    text.includes("PAYROLL_OBLIGATION_PAYMENT_LIABILITY_ACCOUNT_MISSING") ||
    text.includes("PAYROLL_OBLIGATION_PAYMENT_PERIOD_CLOSED") ||
    text.includes("PAYROLL_OBLIGATION_PAYMENT_IDEMPOTENCY_REQUIRED")
  ) {
    return { status: 400, code: "PAYROLL_OBLIGATION_PAYMENT_INVALID", error: text.replace(/^.*?:\s*/, "") }
  }
  return { status: 500, code: "PAYROLL_OBLIGATION_PAYMENT_FAILED", error: "Unable to record the payroll obligation payment." }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; obligationId: string }> | { id: string; obligationId: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const runId = resolvedParams.id
    const obligationId = resolvedParams.obligationId

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const tierDenied = await enforceServiceIndustryMinTier(
      supabase, user.id, business.id, "professional"
    )
    if (tierDenied) return tierDenied

    const { allowed } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_PAY)
    if (!allowed) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

    const paymentDate = String(body.payment_date || "")
    const amount = Number(body.amount)
    const paymentAccountId = String(body.payment_account_id || "")
    const reference = body.reference ? String(body.reference).trim() : null
    const notes = body.notes ? String(body.notes).trim() : null
    const idempotencyKey =
      String(request.headers.get("idempotency-key") || body.idempotency_key || "").trim() ||
      randomUUID()

    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
      return NextResponse.json({ error: "payment_date must be YYYY-MM-DD" }, { status: 400 })
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 })
    }
    if (!paymentAccountId) {
      return NextResponse.json({ error: "payment_account_id is required" }, { status: 400 })
    }

    const { data: payrollRun, error: runError } = await supabase
      .from("payroll_runs")
      .select("id,status")
      .eq("id", runId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()
    if (runError || !payrollRun) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 })

    if (!["approved", "locked"].includes(String(payrollRun.status || ""))) {
      return NextResponse.json(
        {
          error: `Payroll run status "${payrollRun.status}" is not payable`,
          code:
            String(payrollRun.status) === "reversed"
              ? "PAYROLL_RUN_REVERSED"
              : "PAYROLL_REVERSAL_INVALID_STATUS",
        },
        { status: 400 }
      )
    }

    const { data: obligation, error: obligationError } = await supabase
      .from("payroll_obligations")
      .select("*")
      .eq("id", obligationId)
      .eq("business_id", business.id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)
      .single()
    if (obligationError || !obligation) return NextResponse.json({ error: "Payroll obligation not found" }, { status: 404 })

    if (String(obligation.status || "") === "reversed") {
      return NextResponse.json(
        {
          error: "Reversed payroll obligations cannot accept payments",
          code: "PAYROLL_RUN_REVERSED",
        },
        { status: 409 }
      )
    }

    // The atomic RPC re-reads the obligation and posted-payment total under a
    // row lock, so a stale amount_paid cannot block or permit a payment here.

    const { data: paymentAccount } = await supabase
      .from("accounts")
      .select("id, code, sub_type, type, deleted_at, business_id")
      .eq("id", paymentAccountId)
      .eq("business_id", business.id)
      .single()

    const subType = String(paymentAccount?.sub_type || "").toLowerCase()
    const code = String(paymentAccount?.code || "")
    const isAllowedAssetAccount =
      paymentAccount &&
      paymentAccount.type === "asset" &&
      paymentAccount.deleted_at == null &&
      (["cash", "bank", "momo", "mobile_money"].includes(subType) || ["1000", "1010", "1020"].includes(code))

    if (!isAllowedAssetAccount) {
      return NextResponse.json(
        { error: "Selected payment account is invalid. Choose an active cash/bank/momo asset account." },
        { status: 400 }
      )
    }

    const { data: result, error: rpcError } = await supabase.rpc(
      "record_payroll_obligation_payment_atomic",
      {
        p_business_id: business.id,
        p_payroll_run_id: runId,
        p_payroll_obligation_id: obligationId,
        p_payment_date: paymentDate,
        p_amount: amount,
        p_payment_account_id: paymentAccountId,
        p_reference: reference,
        p_notes: notes,
        p_idempotency_key: idempotencyKey,
      }
    )

    if (rpcError || !result) {
      const mapped = mapObligationPaymentError(rpcError?.message || "")
      return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status })
    }

    const recorded = result as {
      payment_id: string
      journal_entry_id: string
      amount: number | string
      amount_paid: number | string
      outstanding: number | string
      obligation_status: string
      latest_payment_date: string | null
      latest_payment_reference: string | null
      reused?: boolean
    }
    const amountPaid = Number(recorded.amount_paid || 0)
    const outstanding = Number(recorded.outstanding || 0)

    return NextResponse.json({
      payment: {
        id: recorded.payment_id,
        business_id: business.id,
        payroll_run_id: runId,
        payroll_obligation_id: obligationId,
        payment_date: paymentDate,
        amount: Number(recorded.amount || amount),
        payment_account_id: paymentAccountId,
        reference: reference || null,
        notes: notes || null,
        journal_entry_id: recorded.journal_entry_id,
        created_by: user.id,
      },
      obligation: {
        ...obligation,
        amount_paid: amountPaid,
        outstanding_amount: outstanding,
        status: recorded.obligation_status,
        latest_payment_date: recorded.latest_payment_date,
        latest_payment_reference: recorded.latest_payment_reference,
        payment_account_id: paymentAccountId,
        journal_entry_id: recorded.journal_entry_id,
      },
      reused: Boolean(recorded.reused),
    }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

