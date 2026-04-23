import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"

export const dynamic = "force-dynamic"

/**
 * Public payment receipt — no session. Uses service role so RLS (business_users-only
 * payments policies) does not block reads. Access is scoped to `public_token` only,
 * same pattern as GET /api/payroll/payslips/public/[token].
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 })
    }

    const supabase = createSupabaseAdminClient()

    // Get payment by public token (invoice nested for receipt document)
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select(
        `
        *,
        invoices (
          id,
          invoice_number,
          issue_date,
          due_date,
          payment_terms,
          notes,
          footer_message,
          currency_code,
          currency_symbol,
          subtotal,
          nhil,
          getfund,
          covid,
          vat,
          total_tax,
          total,
          apply_taxes,
          tax_lines,
          wht_receivable_applicable,
          wht_receivable_rate,
          wht_receivable_amount,
          customers (
            id,
            name,
            email,
            phone,
            whatsapp_phone,
            tin,
            address
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

    const invoiceId = payment.invoice_id as string
    const { data: invoiceItems } = await supabase
      .from("invoice_items")
      .select(
        `
        id,
        description,
        qty,
        unit_price,
        discount_amount,
        line_subtotal,
        products_services ( name )
      `
      )
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true })

    // Get business profile
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("*")
      .eq("id", payment.business_id)
      .single()

    if (businessError) {
      console.error("Error fetching business:", businessError)
    }

    // Calculate remaining balance (payments + applied credits — same basis as invoice UI)
    const { data: allPayments } = await supabase
      .from("payments")
      .select("amount")
      .eq("invoice_id", payment.invoice_id)
      .is("deleted_at", null)

    const { data: appliedCredits } = await supabase
      .from("credit_notes")
      .select("total")
      .eq("invoice_id", invoiceId)
      .eq("status", "applied")
      .is("deleted_at", null)

    const totalPaid = allPayments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0
    const totalCredits = appliedCredits?.reduce((sum, c) => sum + Number(c.total || 0), 0) || 0
    const invoiceTotal = Number(payment.invoices?.total || 0)
    const remainingBalance = invoiceTotal - totalPaid - totalCredits

    return NextResponse.json({
      payment,
      business: business || null,
      remainingBalance: Math.max(0, remainingBalance),
      totalPaid,
      totalCredits,
      invoiceItems: invoiceItems || [],
    })
  } catch (error: any) {
    console.error("Error fetching public receipt:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

