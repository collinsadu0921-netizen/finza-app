import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import {
  PUBLIC_BUSINESS_SELECT,
  PUBLIC_INVOICE_ITEM_SELECT,
  PUBLIC_PAYMENT_RECEIPT_SELECT,
} from "@/lib/publicDocuments/publicDocumentSelects"

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
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    const supabase = createSupabaseAdminClient()

    const paySel = PUBLIC_PAYMENT_RECEIPT_SELECT.replace(/\s+/g, " ").trim()
    const { data: payment, error: paymentError } = (await supabase
      .from("payments")
      .select(paySel)
      .eq("public_token", token)
      .is("deleted_at", null)
      .single()) as {
      data: {
        invoice_id: string
        invoices: { business_id?: string; total?: unknown } | null
      } | null
      error: { message?: string } | null
    }

    if (paymentError || !payment) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    const invoiceId = payment.invoice_id as string
    const businessId = (payment.invoices as { business_id?: string } | null)?.business_id
    if (!businessId) {
      console.error("Public receipt: missing business_id on nested invoice", payment.invoice_id)
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    const { data: invoiceItems } = await supabase
      .from("invoice_items")
      .select(
        `
        ${PUBLIC_INVOICE_ITEM_SELECT},
        products_services ( name )
      `.replace(/\s+/g, " ").trim()
      )
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true })

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select(PUBLIC_BUSINESS_SELECT)
      .eq("id", businessId)
      .single()

    if (businessError) {
      console.error("Error fetching business:", businessError)
    }

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
  } catch (error: unknown) {
    console.error("Error fetching public receipt:", error)
    return NextResponse.json({ error: "Unable to load document" }, { status: 500 })
  }
}
