import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { derivePayrollPaymentSummary } from "@/lib/payroll/payrollPaymentSummary"
import { mapPayrollPaymentAtomicError } from "@/lib/payroll/mapPayrollPaymentAtomicError"
import { resolvePayrollIdempotencyKey } from "@/lib/payroll/resolvePayrollIdempotencyKey"
import {
  enforceServiceIndustryMinTier,
  enforceServiceIndustryMinTierWrite,
} from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

async function getRunPaymentData(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  businessId: string,
  runId: string
) {
  const { data: payrollRun, error: runError } = await supabase
    .from("payroll_runs")
    .select("id, business_id, status, total_net_salary")
    .eq("id", runId)
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .single()

  if (runError || !payrollRun) {
    return { error: "Payroll run not found", status: 404 as const }
  }

  const { data: payments, error: paymentsError } = await supabase
    .from("payroll_payments")
    .select(
      `
      id,
      payroll_run_id,
      payment_date,
      amount,
      payment_account_id,
      reference,
      notes,
      journal_entry_id,
      idempotency_key,
      created_at,
      payment_account:payment_account_id (
        id,
        name,
        code,
        sub_type,
        type
      )
    `
    )
    .eq("business_id", businessId)
    .eq("payroll_run_id", runId)
    .is("deleted_at", null)
    .not("journal_entry_id", "is", null)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false })

  if (paymentsError) {
    return { error: paymentsError.message, status: 500 as const }
  }

  const paidAmount = (payments || []).reduce((sum, p: any) => sum + Number(p.amount || 0), 0)
  const latestPaymentDate = (payments || []).length > 0 ? (payments || [])[0].payment_date : null
  const summary = derivePayrollPaymentSummary(payrollRun.total_net_salary, paidAmount, latestPaymentDate)

  return { payrollRun, payments: payments || [], summary }
}

async function getPaymentAccounts(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  businessId: string
) {
  const { data: typedAssetAccounts } = await supabase
    .from("accounts")
    .select("id, name, code, sub_type, type")
    .eq("business_id", businessId)
    .eq("type", "asset")
    .in("sub_type", ["cash", "bank", "momo", "mobile_money"])
    .is("deleted_at", null)
    .order("code", { ascending: true })

  const { data: fallbackAssetAccounts } = await supabase
    .from("accounts")
    .select("id, name, code, sub_type, type")
    .eq("business_id", businessId)
    .eq("type", "asset")
    .in("code", ["1000", "1010", "1020"])
    .is("deleted_at", null)

  const accountMap = new Map<string, any>()
  for (const account of [...(typedAssetAccounts || []), ...(fallbackAssetAccounts || [])]) {
    accountMap.set(account.id, account)
  }

  return Array.from(accountMap.values()).sort((a, b) => String(a.code).localeCompare(String(b.code)))
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const runId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const tierDeniedPayGet = await enforceServiceIndustryMinTier(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (tierDeniedPayGet) return tierDeniedPayGet

    const { allowed } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_VIEW)
    if (!allowed) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })

    const runData = await getRunPaymentData(supabase, business.id, runId)
    if ("error" in runData) {
      return NextResponse.json({ error: runData.error }, { status: runData.status })
    }

    const paymentAccounts = await getPaymentAccounts(supabase, business.id)

    return NextResponse.json({
      payrollRun: runData.payrollRun,
      summary: runData.summary,
      payments: runData.payments,
      paymentAccounts,
    })
  } catch (error: any) {
    console.error("Error fetching payroll payments:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const runId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const tierDeniedPayPost = await enforceServiceIndustryMinTierWrite(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (tierDeniedPayPost) return tierDeniedPayPost

    const { allowed } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_PAY)
    if (!allowed) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

    const paymentDate = String(body.payment_date || "")
    const amount = Number(body.amount)
    const paymentAccountId = String(body.payment_account_id || "")
    const reference = body.reference ? String(body.reference).trim() : null
    const notes = body.notes ? String(body.notes).trim() : null

    const idempotency = resolvePayrollIdempotencyKey(request, body)
    if (!idempotency.ok) return idempotency.response
    const idempotencyKey = idempotency.key

    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
      return NextResponse.json({ error: "payment_date must be YYYY-MM-DD" }, { status: 400 })
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 })
    }
    if (!paymentAccountId) {
      return NextResponse.json({ error: "payment_account_id is required" }, { status: 400 })
    }

    const { data: result, error: rpcError } = await supabase.rpc("record_payroll_payment_atomic", {
      p_business_id: business.id,
      p_payroll_run_id: runId,
      p_payment_date: paymentDate,
      p_amount: amount,
      p_payment_account_id: paymentAccountId,
      p_reference: reference,
      p_notes: notes,
      p_idempotency_key: idempotencyKey,
    })

    if (rpcError) {
      const mapped = mapPayrollPaymentAtomicError(rpcError)
      const { status, ...payload } = mapped
      return NextResponse.json(payload, { status })
    }

    const refreshed = await getRunPaymentData(supabase, business.id, runId)
    if ("error" in refreshed) {
      return NextResponse.json(
        {
          payment: result,
          summary: null,
          warning: "Payment recorded but summary refresh failed",
        },
        { status: (result as { reused?: boolean })?.reused ? 200 : 201 }
      )
    }

    return NextResponse.json(
      {
        payment: result,
        summary: refreshed.summary,
        payments: refreshed.payments,
        reused: Boolean((result as { reused?: boolean } | null)?.reused),
      },
      { status: (result as { reused?: boolean })?.reused ? 200 : 201 }
    )
  } catch (error: any) {
    console.error("Error creating payroll payment:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
