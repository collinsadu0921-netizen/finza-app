import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getUserRole } from "@/lib/userRoles"
import { createAuditLog } from "@/lib/auditLog"
import { assertBusinessNotArchived } from "@/lib/archivedBusiness"
import { ensureAccountingInitialized } from "@/lib/accountingBootstrap"
import { getCurrencySymbol } from "@/lib/currency"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const {
      business_id,
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
      // FX fields
      currency_code,
      fx_rate,
    } = body

    // Validate required fields
    if (!business_id || !supplier || !date || !amount) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // Allow if user is a member of the requested business (owner or in business_users)
    const role = await getUserRole(supabase, user.id, business_id)
    if (!role) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    try {
      await assertBusinessNotArchived(supabase, business_id)
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Business is archived" }, { status: 403 })
    }

    // Require country and currency before recording expenses (same rule as invoices)
    const { data: businessProfile } = await supabase
      .from("businesses")
      .select("address_country, default_currency")
      .eq("id", business_id)
      .single()

    if (!businessProfile?.address_country) {
      return NextResponse.json(
        { error: "Business country is required. Please set it in Business Profile settings." },
        { status: 400 }
      )
    }

    if (!businessProfile?.default_currency) {
      return NextResponse.json(
        { error: "Business currency is required. Please set it in Business Profile settings." },
        { status: 400 }
      )
    }

    const homeCurrencyCode = businessProfile.default_currency
    const parsedFxRate = fx_rate ? Number(fx_rate) : null
    const isFxExpense = !!(currency_code && currency_code !== homeCurrencyCode)

    if (isFxExpense && (!parsedFxRate || parsedFxRate <= 0)) {
      return NextResponse.json(
        { error: `Exchange rate is required for ${currency_code} expenses. Please enter the current rate.` },
        { status: 400 }
      )
    }

    const fxCurrencySymbol = isFxExpense ? (getCurrencySymbol(currency_code) || currency_code) : null

    const { error: bootstrapErr } = await ensureAccountingInitialized(supabase, business_id)
    if (bootstrapErr) {
      return NextResponse.json(
        { error: bootstrapErr },
        { status: 500 }
      )
    }

    // Create expense
    const { data: expense, error: expenseError } = await supabase
      .from("expenses")
      .insert({
        business_id,
        supplier,
        category_id: category_id || null,
        amount: Number(amount),
        nhil: Number(nhil || 0),
        getfund: Number(getfund || 0),
        covid: Number(covid || 0),
        vat: Number(vat || 0),
        total: Number(total || amount),
        date,
        notes: notes || null,
        receipt_path: receipt_path || null,
        // FX fields
        currency_code: isFxExpense ? currency_code : null,
        currency_symbol: isFxExpense ? fxCurrencySymbol : null,
        fx_rate: isFxExpense ? parsedFxRate : null,
        home_currency_code: isFxExpense ? homeCurrencyCode : null,
        home_currency_total: isFxExpense && parsedFxRate
          ? Math.round(Number(total || amount) * parsedFxRate * 100) / 100
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
      // Period closed/locked: return 400 with DB message for UX
      if (
        msg.includes("Accounting period is locked") ||
        msg.includes("Accounting period is soft-closed") ||
        msg.includes("period is locked") ||
        msg.includes("period is soft-closed") ||
        msg.includes("Cannot modify expenses in a closed or locked accounting period")
      ) {
        return NextResponse.json(
          { error: msg, code: "PERIOD_CLOSED" },
          { status: 400 }
        )
      }
      return NextResponse.json(
        { error: msg },
        { status: 500 }
      )
    }

    // Log audit entry
    await createAuditLog({
      businessId: business_id,
      userId: user?.id || null,
      actionType: "expense.created",
      entityType: "expense",
      entityId: expense.id,
      oldValues: null,
      newValues: expense,
      request,
    })

    return NextResponse.json({ 
      success: true,
      expense: expense 
    }, { status: 201 })
  } catch (error: any) {
    console.error("Error in expense creation:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

