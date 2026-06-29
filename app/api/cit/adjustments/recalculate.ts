import { calculateGhanaCitAmount, roundGhanaCitMoney } from "@/lib/tax/ghanaCit"

type SupabaseLike = {
  from: (table: string) => any
}

type CitProvisionForAdjustment = {
  id: string
  business_id: string
  status: "draft" | "posted" | "paid"
  profit_before_tax: number | string | null
  chargeable_income: number | string | null
  cit_rate: number | string | null
  gross_revenue: number | string | null
}

export type CitAdjustmentType = "add_back" | "deduction"

export const CIT_ADJUSTMENT_TYPES = ["add_back", "deduction"] as const

export function isCitAdjustmentType(value: unknown): value is CitAdjustmentType {
  return typeof value === "string" && CIT_ADJUSTMENT_TYPES.includes(value as CitAdjustmentType)
}

export function normalizePositiveAmount(value: unknown): number | null {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return roundGhanaCitMoney(amount)
}

export async function fetchCitProvisionForAdjustment(
  supabase: SupabaseLike,
  provisionId: string
): Promise<{ provision: CitProvisionForAdjustment | null; error: any | null }> {
  const { data, error } = await supabase
    .from("cit_provisions")
    .select("id, business_id, status, profit_before_tax, chargeable_income, cit_rate, gross_revenue")
    .eq("id", provisionId)
    .maybeSingle()

  return { provision: data ?? null, error }
}

export async function validateCitAdjustmentAccount(
  supabase: SupabaseLike,
  input: { accountId?: string | null; businessId: string }
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (!input.accountId) return { ok: true }
  const { data, error } = await supabase
    .from("accounts")
    .select("id")
    .eq("id", input.accountId)
    .eq("business_id", input.businessId)
    .is("deleted_at", null)
    .maybeSingle()

  if (error) return { ok: false, error: error.message, status: 500 }
  if (!data) return { ok: false, error: "account_id must belong to the same business", status: 400 }
  return { ok: true }
}

export async function recalculateCitProvisionFromAdjustments(
  supabase: SupabaseLike,
  provision: CitProvisionForAdjustment
): Promise<{ provision: any | null; error: any | null }> {
  const { data: adjustments, error: adjustmentsError } = await supabase
    .from("cit_adjustments")
    .select("adjustment_type, amount")
    .eq("business_id", provision.business_id)
    .eq("provision_id", provision.id)

  if (adjustmentsError) return { provision: null, error: adjustmentsError }

  const addBacksTotal = roundGhanaCitMoney(
    (adjustments ?? [])
      .filter((row: any) => row.adjustment_type === "add_back")
      .reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0)
  )
  const deductionsTotal = roundGhanaCitMoney(
    (adjustments ?? [])
      .filter((row: any) => row.adjustment_type === "deduction")
      .reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0)
  )

  const profitBeforeTax = Number(provision.profit_before_tax ?? provision.chargeable_income ?? 0)
  const chargeableIncome = roundGhanaCitMoney(profitBeforeTax + addBacksTotal - deductionsTotal)
  const taxableBase = Math.max(0, chargeableIncome)
  const { citAmount } = calculateGhanaCitAmount({
    chargeableIncome: taxableBase,
    grossRevenue: Number(provision.gross_revenue ?? 0),
    rate: Number(provision.cit_rate ?? 0.25),
  })

  const { data: updatedProvision, error: updateError } = await supabase
    .from("cit_provisions")
    .update({
      add_backs_total: addBacksTotal,
      deductions_total: deductionsTotal,
      chargeable_income: taxableBase,
      cit_amount: citAmount,
    })
    .eq("id", provision.id)
    .eq("business_id", provision.business_id)
    .select("*")
    .single()

  return { provision: updatedProvision ?? null, error: updateError }
}
