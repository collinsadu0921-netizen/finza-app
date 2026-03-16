import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { normalizeCountry, assertMethodAllowed } from "@/lib/payments/eligibility"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle Next.js 16 params (can be a Promise)
    const resolvedParams = await Promise.resolve(params)
    const billId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    // AUTH DISABLED FOR DEVELOPMENT
    // const business = await getCurrentBusiness(supabase, user.id)
    // if (!business) {
    //   return NextResponse.json({ error: "Business not found" }, { status: 404 })
    // }

    const { data: payments, error } = await supabase
      .from("bill_payments")
      .select("*")
      .eq("bill_id", billId)
      // AUTH DISABLED FOR DEVELOPMENT
      // .eq("business_id", business.id)
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
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    // AUTH DISABLED FOR DEVELOPMENT - Get business_id from request body or query
    const body = await request.json()
    const { amount, date, method, reference, notes, business_id } = body

    if (!amount || !date || !method) {
      return NextResponse.json(
        { error: "Missing required fields: amount, date, and method are required" },
        { status: 400 }
      )
    }

    // Validate payment method
    const allowedMethods = ['cash', 'bank', 'momo', 'cheque', 'card', 'other']
    if (!allowedMethods.includes(method)) {
      return NextResponse.json(
        { error: `Invalid payment method. Allowed values: ${allowedMethods.join(', ')}` },
        { status: 400 }
      )
    }

    if (!business_id) {
      return NextResponse.json(
        { error: "business_id is required" },
        { status: 400 }
      )
    }

    // Verify bill exists and is open (payments only for open bills)
    const { data: bill } = await supabase
      .from("bills")
      .select("id, total, business_id, status")
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

    if (bill.status !== "open") {
      return NextResponse.json(
        { error: "Cannot add payment to a draft bill. Mark bill as Open first." },
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
    const balance = Number(bill.total) - totalPaid

    if (Number(amount) > balance) {
      return NextResponse.json(
        { error: `Payment amount (₵${Number(amount).toFixed(2)}) exceeds bill balance (₵${balance.toFixed(2)})` },
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

