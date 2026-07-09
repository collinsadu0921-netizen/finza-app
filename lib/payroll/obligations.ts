import type { SupabaseClient } from "@supabase/supabase-js"
import {
  computePensionTierAmounts,
  pensionObligationLiabilityCodes,
} from "@/lib/payroll/pensionTierSplit"

async function payrollJournalHasTier2232Credit(
  supabase: SupabaseClient,
  businessId: string,
  journalEntryId: string | null | undefined
): Promise<boolean> {
  if (!journalEntryId) return false
  const { data: account } = await supabase
    .from("accounts")
    .select("id")
    .eq("business_id", businessId)
    .eq("code", "2232")
    .is("deleted_at", null)
    .maybeSingle()
  if (!account?.id) return false
  const { data: line } = await supabase
    .from("journal_entry_lines")
    .select("id")
    .eq("journal_entry_id", journalEntryId)
    .eq("account_id", account.id)
    .gt("credit", 0.01)
    .limit(1)
    .maybeSingle()
  return !!line
}

export type PayrollObligationType =
  | "salary_net"
  | "paye_gra"
  | "ssnit_tier1"
  | "tier2_pension"
  | "other_employee_deductions"

type ObligationRow = {
  id: string
  obligation_type: PayrollObligationType
  amount_due: number
  amount_paid: number
  due_date: string | null
  liability_account_code: string | null
  label: string
}

type GenerateOptions = {
  allowLegacyDerivation?: boolean
}

export function deriveOtherDeductionsRecoveryPaid(
  amountDue: number,
  salaryAdvanceRecoveredOnApproval: number
): number {
  const due = Number(amountDue || 0)
  const recovered = Number(salaryAdvanceRecoveredOnApproval || 0)
  if (due <= 0.01 || recovered <= 0.01) return 0
  return Math.min(due, recovered)
}

export function nextMonthPayeDueDate(payrollMonth: string): string {
  const d = new Date(`${String(payrollMonth).slice(0, 10)}T00:00:00.000Z`)
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 15))
  return next.toISOString().slice(0, 10)
}

export function statusFromAmounts(amountDue: number, amountPaid: number): "unpaid" | "partially_paid" | "paid" {
  const due = Number(amountDue || 0)
  const paid = Number(amountPaid || 0)
  const outstanding = Math.max(0, due - paid)
  if (due <= 0 || outstanding <= 0.01) return "paid"
  if (paid > 0) return "partially_paid"
  return "unpaid"
}

/**
 * Net salary obligation paid amount: payroll_payments is source of truth.
 * Merge saved payroll_obligations.amount_paid with summed payments (covers stale rows).
 */
export function mergeSalaryNetObligationPaid(opts: {
  amountDue: number
  obligationSavedPaid: number
  payrollPaymentsSum: number
}): {
  amountPaid: number
  outstandingAmount: number
  status: "unpaid" | "partially_paid" | "paid"
} {
  const due = Number(opts.amountDue || 0)
  const saved = Number(opts.obligationSavedPaid || 0)
  const paymentsSum = Number(opts.payrollPaymentsSum || 0)
  const effectivePaid = Math.min(due, Math.max(saved, paymentsSum))
  const outstandingAmount = Math.max(0, due - effectivePaid)
  const status = statusFromAmounts(due, effectivePaid)
  return { amountPaid: effectivePaid, outstandingAmount, status }
}

/**
 * Single source of truth for obligation paid/outstanding display (API + CSV export).
 * Mirrors GET /api/payroll/runs/[id]/obligations row mapping.
 */
export function computePayrollObligationDisplayFields(
  o: Record<string, unknown>,
  ctx: {
    payrollPaymentsSum: number
    salaryAdvanceRecoveredOnApproval: number
  }
): {
  label: string
  amount_due: number
  amount_paid: number
  outstanding_amount: number
  status: string
  status_display: string
  internal_note: string | null
  is_payable: boolean
} {
  const amountDue = Number(o.amount_due ?? 0)
  const savedPaid = Number(o.amount_paid ?? 0)
  const obligationType = String(o.obligation_type ?? "")
  const isSalaryNet = obligationType === "salary_net"
  const isOtherDeductions = obligationType === "other_employee_deductions"

  let amountPaid: number
  let outstanding: number
  let computedStatus: string

  if (isSalaryNet) {
    const merged = mergeSalaryNetObligationPaid({
      amountDue,
      obligationSavedPaid: savedPaid,
      payrollPaymentsSum: ctx.payrollPaymentsSum,
    })
    amountPaid = merged.amountPaid
    outstanding = merged.outstandingAmount
    computedStatus = merged.status
  } else {
    const recoveredPaid = isOtherDeductions
      ? Math.min(amountDue, ctx.salaryAdvanceRecoveredOnApproval)
      : 0
    amountPaid = Math.min(amountDue, Math.max(savedPaid, recoveredPaid))
    outstanding = Math.max(0, amountDue - amountPaid)
    computedStatus = String(o.status ?? "unpaid")
  }

  const internallyCleared = isOtherDeductions && outstanding <= 0.01

  const label =
    isOtherDeductions && internallyCleared
      ? "Salary advance recoveries"
      : String(o.label ?? "")

  const status = isSalaryNet ? computedStatus : String(o.status ?? "unpaid")
  const status_display = internallyCleared
    ? "Recovered"
    : isSalaryNet
      ? computedStatus
      : String(o.status ?? "unpaid")

  const internal_note = internallyCleared
    ? "Internal recoveries are deducted from net salary and cleared through payroll accounting."
    : null

  const is_payable = isSalaryNet ? outstanding > 0.01 : !internallyCleared

  return {
    label,
    amount_due: amountDue,
    amount_paid: amountPaid,
    outstanding_amount: outstanding,
    status,
    status_display,
    internal_note,
    is_payable,
  }
}

async function syncObligation(
  supabase: SupabaseClient,
  businessId: string,
  payrollRunId: string,
  payload: {
    obligation_type: PayrollObligationType
    label: string
    amount_due: number
    minimum_amount_paid?: number
    due_date: string | null
    liability_account_code: string | null
  },
  existingByType: Map<PayrollObligationType, ObligationRow>
) {
  const due = Number(payload.amount_due || 0)
  if (due <= 0.01) return
  const minimumAmountPaid = Number(payload.minimum_amount_paid || 0)

  const existing = existingByType.get(payload.obligation_type)
  if (existing) {
    const paidBase = Math.max(Number(existing.amount_paid || 0), minimumAmountPaid)
    const cappedPaid = Math.min(paidBase, due)
    const status = statusFromAmounts(due, cappedPaid)
    await supabase
      .from("payroll_obligations")
      .update({
        label: payload.label,
        amount_due: due,
        amount_paid: cappedPaid,
        due_date: payload.due_date,
        liability_account_code: payload.liability_account_code,
        status,
      })
      .eq("id", existing.id)
  } else {
    const startingPaid = Math.min(Math.max(0, minimumAmountPaid), due)
    await supabase.from("payroll_obligations").insert({
      business_id: businessId,
      payroll_run_id: payrollRunId,
      obligation_type: payload.obligation_type,
      label: payload.label,
      amount_due: due,
      amount_paid: startingPaid,
      status: statusFromAmounts(due, startingPaid),
      due_date: payload.due_date,
      liability_account_code: payload.liability_account_code,
    })
  }
}

export async function generateOrSyncPayrollObligationsForRun(
  supabase: SupabaseClient,
  businessId: string,
  payrollRunId: string,
  options: GenerateOptions = {}
): Promise<{ warning: string | null }> {
  const { data: run, error: runError } = await supabase
    .from("payroll_runs")
    .select("id,business_id,payroll_month,status,total_net_salary,total_paye,total_deductions,total_ssnit_employee,total_ssnit_employer,journal_entry_id")
    .eq("id", payrollRunId)
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .single()

  if (runError || !run) {
    throw new Error("Payroll run not found for obligations generation")
  }

  if (!["approved", "locked"].includes(String(run.status || ""))) {
    throw new Error("Obligations can only be generated for approved/locked payroll runs")
  }

  const { data: entries } = await supabase
    .from("payroll_entries")
    .select("tier1_ssnit_remittance,tier2_pension_remittance")
    .eq("payroll_run_id", payrollRunId)

  const tier1FromSnapshot = (entries || []).reduce(
    (sum, e: any) => sum + Number(e.tier1_ssnit_remittance || 0),
    0
  )
  const tier2FromSnapshot = (entries || []).reduce(
    (sum, e: any) => sum + Number(e.tier2_pension_remittance || 0),
    0
  )

  let warning: string | null = null

  const { data: advanceRepaymentRows } = await supabase
    .from("salary_advance_repayments")
    .select("amount")
    .eq("business_id", businessId)
    .eq("payroll_run_id", payrollRunId)
    .eq("status", "posted")

  const salaryAdvanceRecoveredOnApproval = (advanceRepaymentRows || []).reduce(
    (sum, row: any) => sum + Number(row.amount || 0),
    0
  )

  const aggregatePension = Number(run.total_ssnit_employee || 0) + Number(run.total_ssnit_employer || 0)
  let tier1Due: number
  let tier2Due: number
  try {
    const computed = computePensionTierAmounts(
      tier1FromSnapshot,
      tier2FromSnapshot,
      aggregatePension,
      { allowLegacyDerivation: options.allowLegacyDerivation === true }
    )
    tier1Due = computed.tier1
    tier2Due = computed.tier2
    if (computed.usedFallback && aggregatePension > 0.01) {
      warning = "Tier amounts estimated from pension totals (per-employee pension details missing or inconsistent)"
    }
  } catch (e) {
    throw e instanceof Error ? e : new Error("Pension tier amounts could not be derived for obligations")
  }

  const journalHasTier2232Credit = await payrollJournalHasTier2232Credit(
    supabase,
    businessId,
    (run as { journal_entry_id?: string | null }).journal_entry_id ?? null
  )
  const pensionLiabCodes = pensionObligationLiabilityCodes(journalHasTier2232Credit)

  const { data: existingRows } = await supabase
    .from("payroll_obligations")
    .select("id,obligation_type,amount_due,amount_paid,due_date,liability_account_code,label")
    .eq("business_id", businessId)
    .eq("payroll_run_id", payrollRunId)
    .is("deleted_at", null)

  const existingByType = new Map<PayrollObligationType, ObligationRow>()
  for (const row of existingRows || []) {
    existingByType.set(row.obligation_type as PayrollObligationType, row as ObligationRow)
  }

  await syncObligation(supabase, businessId, payrollRunId, {
    obligation_type: "salary_net",
    label: "Net salaries payable",
    amount_due: Number(run.total_net_salary || 0),
    due_date: String(run.payroll_month || "").slice(0, 10),
    liability_account_code: "2240",
  }, existingByType)

  await syncObligation(supabase, businessId, payrollRunId, {
    obligation_type: "paye_gra",
    label: "PAYE payable to GRA",
    amount_due: Number(run.total_paye || 0),
    due_date: nextMonthPayeDueDate(String(run.payroll_month)),
    liability_account_code: "2230",
  }, existingByType)

  await syncObligation(supabase, businessId, payrollRunId, {
    obligation_type: "ssnit_tier1",
    label: "SSNIT / Tier 1 pension remittance",
    amount_due: tier1Due,
    due_date: null,
    liability_account_code: pensionLiabCodes.tier1,
  }, existingByType)

  await syncObligation(supabase, businessId, payrollRunId, {
    obligation_type: "tier2_pension",
    label: "Tier 2 pension remittance",
    amount_due: tier2Due,
    due_date: null,
    liability_account_code: pensionLiabCodes.tier2,
  }, existingByType)

  const otherDeductionsDue = Number(run.total_deductions || 0)
  const otherDeductionsRecovered = deriveOtherDeductionsRecoveryPaid(
    otherDeductionsDue,
    salaryAdvanceRecoveredOnApproval
  )

  // TODO(payroll): add deduction destination taxonomy so this can split internal
  // recoveries vs true external remittances:
  // internal_recovery | external_payable | staff_loan_recovery | union_dues | court_order | other
  await syncObligation(supabase, businessId, payrollRunId, {
    obligation_type: "other_employee_deductions",
    label:
      otherDeductionsRecovered >= otherDeductionsDue - 0.01
        ? "Salary advance recoveries"
        : "Employee deductions / recoveries",
    amount_due: otherDeductionsDue,
    minimum_amount_paid: otherDeductionsRecovered,
    due_date: null,
    liability_account_code: "2241",
  }, existingByType)

  return { warning }
}

