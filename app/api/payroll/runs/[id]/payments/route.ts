import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { derivePayrollPaymentSummary } from "@/lib/payroll/payrollPaymentSummary"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

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

    const tierDeniedPayPost = await enforceServiceIndustryMinTier(
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

    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
      return NextResponse.json({ error: "payment_date must be YYYY-MM-DD" }, { status: 400 })
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 })
    }
    if (!paymentAccountId) {
      return NextResponse.json({ error: "payment_account_id is required" }, { status: 400 })
    }

    const runData = await getRunPaymentData(supabase, business.id, runId)
    if ("error" in runData) {
      return NextResponse.json({ error: runData.error }, { status: runData.status })
    }

    if (runData.payrollRun.status === "draft") {
      return NextResponse.json(
        { error: "Cannot record salary payment for draft payroll runs" },
        { status: 400 }
      )
    }
    if (!["approved", "locked"].includes(runData.payrollRun.status)) {
      return NextResponse.json(
        { error: `Payroll run status "${runData.payrollRun.status}" is not payable` },
        { status: 400 }
      )
    }

    if (amount - runData.summary.outstanding_amount > 0.01) {
      return NextResponse.json(
        {
          error: `Payment amount exceeds outstanding net salaries payable (outstanding: ${runData.summary.outstanding_amount.toFixed(2)})`,
        },
        { status: 400 }
      )
    }

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

    const { data: payment, error: insertError } = await supabase
      .from("payroll_payments")
      .insert({
        business_id: business.id,
        payroll_run_id: runId,
        payment_date: paymentDate,
        amount,
        payment_account_id: paymentAccountId,
        reference: reference || null,
        notes: notes || null,
        created_by: user.id,
      })
      .select("*")
      .single()

    if (insertError || !payment) {
      return NextResponse.json({ error: insertError?.message || "Failed to create payroll payment" }, { status: 500 })
    }

    const { data: journalEntryId, error: postError } = await supabase.rpc(
      "post_payroll_payment_to_ledger",
      { p_payroll_payment_id: payment.id }
    )

    if (postError || !journalEntryId) {
      await supabase.from("payroll_payments").delete().eq("id", payment.id)
      return NextResponse.json(
        { error: postError?.message || "Failed to post payroll payment to ledger" },
        { status: 500 }
      )
    }

    const refreshed = await getRunPaymentData(supabase, business.id, runId)
    if ("error" in refreshed) {
      return NextResponse.json(
        {
          payment: { ...payment, journal_entry_id: journalEntryId },
          summary: null,
          warning: "Payment posted but summary refresh failed",
        },
        { status: 201 }
      )
    }

    return NextResponse.json(
      {
        payment: { ...payment, journal_entry_id: journalEntryId },
        summary: refreshed.summary,
        payments: refreshed.payments,
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error("Error creating payroll payment:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
