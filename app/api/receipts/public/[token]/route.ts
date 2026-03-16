import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabaseClient"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    // Get payment by public token
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select(
        `
        *,
        invoices (
          id,
          invoice_number,
          total,
          customers (
            id,
            name,
            email,
            phone,
            whatsapp_phone
          )
        )
      `
      )
      .eq("public_token", token)
      .is("deleted_at", null)
      .single()

    if (paymentError || !payment) {
      return NextResponse.json(
        { error: "Receipt not found" },
        { status: 404 }
      )
    }

    // Get business profile
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("*")
      .eq("id", payment.business_id)
      .single()

    if (businessError) {
      console.error("Error fetching business:", businessError)
    }

    // Calculate remaining balance
    const { data: allPayments } = await supabase
      .from("payments")
      .select("amount")
      .eq("invoice_id", payment.invoice_id)
      .is("deleted_at", null)

    const totalPaid = allPayments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0
    const invoiceTotal = Number(payment.invoices?.total || 0)
    const remainingBalance = invoiceTotal - totalPaid

    return NextResponse.json({
      payment,
      business: business || null,
      remainingBalance: Math.max(0, remainingBalance),
    })
  } catch (error: any) {
    console.error("Error fetching public receipt:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

