import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { normalizeCountry, assertMethodAllowed } from "@/lib/payments/eligibility"
import { billSupplierBalanceRemaining } from "@/lib/billBalance"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle Next.js 16 params (can be a Promise)
    const resolvedParams = await Promise.resolve(params)
    const billId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const denied = await enforceServiceWorkspaceAccess({
      supabase, userId: user.id, businessId: business.id, minTier: "professional",
    })
    if (denied) return denied

    const { data: payments, error } = await supabase
      .from("bill_payments")
      .select("*")
      .eq("bill_id", billId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("date", { ascending: false })

    if (error) {
      console.error("Error fetching bill payments:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ payments: payments || [] })
  } catch (error: any) {
    console.error("Error fetching bill payments:", error)
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
    // Handle Next.js 16 params (can be a Promise)
    const resolvedParams = await Promise.resolve(params)
    const billId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const {
      amount,
      date,
      method,
      reference,
      notes,
      business_id,
      settlement_fx_rate,
    } = body

    if (!amount || !date || !method) {
      return NextResponse.json(
        { error: "Missing required fields: amount, date, and method are required" },
        { status: 400 }
      )
    }

    // Validate payment method
    const allowedMethods = ['cash', 'bank', 'momo', 'cheque', 'card', 'paystack', 'other']
    if (!allowedMethods.includes(method)) {
      return NextResponse.json(
        { error: `Invalid payment method. Allowed values: ${allowedMethods.join(', ')}` },
        { status: 400 }
      )
    }

    if (!business_id) {
      return NextResponse.json({ error: "business_id is required" }, { status: 400 })
    }

    const denied = await enforceServiceWorkspaceAccess({
      supabase, userId: user.id, businessId: business_id, minTier: "professional",
    })
    if (denied) return denied

    // Verify bill exists and is open (payments only for open bills)
    const { data: bill } = await supabase
      .from("bills")
      .select(
        "id, total, business_id, status, wht_applicable, wht_amount, currency_code, fx_rate, home_currency_code"
      )
      .eq("id", billId)
      .eq("business_id", business_id)
      .is("deleted_at", null)
      .single()

    if (!bill) {
      return NextResponse.json(
        { error: "Bill not found" },
        { status: 404 }
      )
    }

    const canReceivePayment = ["open", "partially_paid", "overdue"].includes(bill.status)
    if (!canReceivePayment) {
      if (bill.status === "draft") {
        return NextResponse.json(
          { error: "Cannot add payment to a draft bill. Mark bill as Open first." },
          { status: 400 }
        )
      }
      if (bill.status === "paid") {
        return NextResponse.json(
          { error: "This bill is already fully paid." },
          { status: 400 }
        )
      }
      return NextResponse.json(
        { error: "Payments cannot be added to this bill in its current status." },
        { status: 400 }
      )
    }

    // Load business to check country eligibility
    const { data: business } = await supabase
      .from("businesses")
      .select("id, address_country")
      .eq("id", business_id)
      .single()

    if (!business) {
      return NextResponse.json(
        { error: "Business not found" },
        { status: 404 }
      )
    }

    // Check payment method eligibility by country
    const countryCode = normalizeCountry(business.address_country)
    
    // Map legacy method names to new method names
    const methodMap: Record<string, "cash" | "card" | "mobile_money" | "bank_transfer"> = {
      "cash": "cash",
      "card": "card",
      "momo": "mobile_money",
      "bank": "bank_transfer",
    }
    
    const normalizedMethod = methodMap[method]
    
    // Only check eligibility for methods that map to new system
    // Legacy methods like "cheque" and "other" are allowed for backward compatibility
    if (normalizedMethod) {
      try {
        assertMethodAllowed(countryCode, normalizedMethod)
      } catch (error: any) {
        return NextResponse.json(
          { 
            error: error.message || "Payment method/provider not available for your country."
          },
          { status: 403 }
        )
      }
    }

    // Check if payment exceeds balance
    const { data: existingPayments } = await supabase
      .from("bill_payments")
      .select("amount")
      .eq("bill_id", billId)
      .is("deleted_at", null)

    const totalPaid = existingPayments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0
    const balance = billSupplierBalanceRemaining(
      Number(bill.total),
      bill.wht_applicable,
      bill.wht_amount,
      totalPaid
    )

    if (Number(amount) > balance) {
      return NextResponse.json(
        { error: `Payment amount (₵${Number(amount).toFixed(2)}) exceeds amount owed to supplier (₵${balance.toFixed(2)})` },
        { status: 400 }
      )
    }

    let homeCode: string | null = bill.home_currency_code ?? null
    if (!homeCode) {
      const { data: bizRow } = await supabase
        .from("businesses")
        .select("default_currency")
        .eq("id", business_id)
        .maybeSingle()
      homeCode = bizRow?.default_currency ?? null
    }

    const isFxBill = !!(
      bill.fx_rate &&
      bill.currency_code &&
      homeCode &&
      bill.currency_code !== homeCode
    )
    const parsedSettlementFxRate = settlement_fx_rate
      ? Number(settlement_fx_rate)
      : null
    if (isFxBill && (!parsedSettlementFxRate || parsedSettlementFxRate <= 0)) {
      return NextResponse.json(
        {
          error: `Settlement rate is required for ${bill.currency_code} bills. Enter today's exchange rate (1 ${bill.currency_code} = ? ${homeCode}).`,
        },
        { status: 400 }
      )
    }

    // Create payment
    const { data: payment, error: paymentError } = await supabase
      .from("bill_payments")
      .insert({
        business_id: business_id,
        bill_id: billId,
        amount: Number(amount),
        date,
        method: method.trim().toLowerCase(), // Ensure lowercase and trimmed
        reference: reference?.trim() || null,
        notes: notes?.trim() || null,
        settlement_fx_rate: isFxBill ? parsedSettlementFxRate : null,
      })
      .select()
      .single()

    if (paymentError) {
      console.error("Error creating payment:", paymentError)
      return NextResponse.json(
        { error: paymentError.message },
        { status: 500 }
      )
    }

    // Status will be updated automatically by trigger

    return NextResponse.json({ payment }, { status: 201 })
  } catch (error: any) {
    console.error("Error creating bill payment:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

