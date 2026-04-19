import type { SupabaseClient } from "@supabase/supabase-js"
import type { NextRequest } from "next/server"
import { createAuditLog } from "@/lib/auditLog"
import { assertBusinessNotArchived } from "@/lib/archivedBusiness"
import { ensureAccountingInitialized } from "@/lib/accountingBootstrap"
import { getCurrencySymbol } from "@/lib/currency"

export type InsertExpensePayload = {
  supplier: string
  category_id?: string | null
  amount: number
  nhil?: number
  getfund?: number
  covid?: number
  vat?: number
  total: number
  date: string
  notes?: string | null
  receipt_path?: string | null
  currency_code?: string | null
  fx_rate?: number | null
}

export type InsertExpenseResult =
  | { ok: true; expense: Record<string, unknown> }
  | { ok: false; status: number; error: string; code?: string }

/**
 * Persists an expense row; DB trigger posts to the ledger via {@code post_expense_to_ledger}.
 * Shared neutral path for canonical and retail-native expense APIs.
 */
export async function insertExpenseForBusiness(
  supabase: SupabaseClient,
  opts: {
    businessId: string
    userId: string
    payload: InsertExpensePayload
    request: NextRequest | null
    /** Shorter copy for retail callers */
    profileSettingsLabel?: "Business Profile" | "Store profile"
  }
): Promise<InsertExpenseResult> {
  const { businessId, userId, payload, request } = opts
  const profileLabel = opts.profileSettingsLabel ?? "Business Profile"

  const {
    supplier,
    category_id,
    amount,
    nhil,
    getfund,
    covid,
    vat,
    total,
    date,
    notes,
    receipt_path,
    currency_code,
    fx_rate,
  } = payload

  if (!supplier?.trim() || !date || amount == null || Number.isNaN(Number(amount))) {
    return { ok: false, status: 400, error: "Missing required fields" }
  }

  try {
    await assertBusinessNotArchived(supabase, businessId)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Business is archived"
    return { ok: false, status: 403, error: msg }
  }

  const { data: businessProfile } = await supabase
    .from("businesses")
    .select("address_country, default_currency")
    .eq("id", businessId)
    .single()

  if (!businessProfile?.address_country) {
    return {
      ok: false,
      status: 400,
      error: `Country is required. Set it in ${profileLabel} first.`,
    }
  }

  if (!businessProfile?.default_currency) {
    return {
      ok: false,
      status: 400,
      error: `Currency is required. Set it in ${profileLabel} first.`,
    }
  }

  const homeCurrencyCode = businessProfile.default_currency
  const parsedFxRate = fx_rate != null ? Number(fx_rate) : null
  const isFxExpense = !!(currency_code && currency_code !== homeCurrencyCode)

  if (isFxExpense && (!parsedFxRate || parsedFxRate <= 0)) {
    return {
      ok: false,
      status: 400,
      error: `Exchange rate is required for ${currency_code} expenses.`,
    }
  }

  const fxCurrencySymbol = isFxExpense ? (getCurrencySymbol(currency_code!) || currency_code) : null

  const { error: bootstrapErr } = await ensureAccountingInitialized(supabase, businessId)
  if (bootstrapErr) {
    return { ok: false, status: 500, error: bootstrapErr }
  }

  const { data: expense, error: expenseError } = await supabase
    .from("expenses")
    .insert({
      business_id: businessId,
      supplier: supplier.trim(),
      category_id: category_id || null,
      amount: Number(amount),
      nhil: Number(nhil || 0),
      getfund: Number(getfund || 0),
      covid: Number(covid || 0),
      vat: Number(vat || 0),
      total: Number(total ?? amount),
      date,
      notes: notes || null,
      receipt_path: receipt_path || null,
      currency_code: isFxExpense ? currency_code : null,
      currency_symbol: isFxExpense ? fxCurrencySymbol : null,
      fx_rate: isFxExpense ? parsedFxRate : null,
      home_currency_code: isFxExpense ? homeCurrencyCode : null,
      home_currency_total:
        isFxExpense && parsedFxRate
          ? Math.round(Number(total ?? amount) * parsedFxRate * 100) / 100
          : null,
    })
    .select(
      `
        *,
        expense_categories (
          id,
          name
        )
      `
    )
    .single()

  if (expenseError) {
    console.error("Error creating expense:", expenseError)
    const msg = expenseError.message ?? ""
    if (
      msg.includes("Accounting period is locked") ||
      msg.includes("Accounting period is soft-closed") ||
      msg.includes("period is locked") ||
      msg.includes("period is soft-closed") ||
      msg.includes("Cannot modify expenses in a closed or locked accounting period")
    ) {
      return { ok: false, status: 400, error: msg, code: "PERIOD_CLOSED" }
    }
    return { ok: false, status: 500, error: msg }
  }

  await createAuditLog({
    businessId,
    userId,
    actionType: "expense.created",
    entityType: "expense",
    entityId: (expense as { id: string }).id,
    oldValues: null,
    newValues: expense as Record<string, unknown>,
    request: request ?? undefined,
  })

  return { ok: true, expense: expense as Record<string, unknown> }
}
