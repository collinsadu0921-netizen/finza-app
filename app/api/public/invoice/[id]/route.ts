/**
 * Public Invoice API — no authentication required.
 *
 * Used by:
 *  - /pay/[invoiceId]          (payment page)
 *  - /pay/[invoiceId]/view     (customer invoice view)
 *
 * Returns invoice + line items + payments + business name.
 * Does NOT return sensitive business or customer data beyond what's
 * needed to display the invoice to the payer.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getManualWalletInstructionsForInvoice } from "@/lib/tenantPayments/publicInvoiceManualWallet"
import { resolvePublicInvoicePaymentFlow } from "@/lib/tenantPayments/publicInvoicePaymentFlow"

export const dynamic = "force-dynamic"

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const { id: invoiceId } = await Promise.resolve(params)

  if (!invoiceId) {
    return NextResponse.json({ error: "Invoice ID required" }, { status: 400 })
  }

  const supabase = serviceClient()

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select(`
      id, business_id, invoice_number, issue_date, due_date, payment_terms,
      notes, footer_message, currency_code, currency_symbol,
      subtotal, nhil, getfund, covid, vat, total_tax, total,
      apply_taxes, status, public_token, sent_at, tax_lines,
      wht_receivable_applicable, wht_receivable_rate, wht_receivable_amount,
      customers (
        id, name, email, phone, address
      ),
      businesses (
        id, name, address_country, address, phone, email, logo_url
      )
    `)
    .eq("id", invoiceId)
    .is("deleted_at", null)
    .single()

  if (invErr || !invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
  }

  // Reject draft invoices from public view
  if (invoice.status === "draft") {
    return NextResponse.json({ error: "This invoice is not yet issued" }, { status: 403 })
  }

  const { data: items } = await supabase
    .from("invoice_items")
    .select("id, description, qty, unit_price, discount_amount, line_subtotal")
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: true })

  const { data: payments } = await supabase
    .from("payments")
    .select("id, amount, date, method, notes, reference, public_token")
    .eq("invoice_id", invoiceId)
    .is("deleted_at", null)
    .order("date", { ascending: false })

  const totalPaid    = (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0)
  const remaining    = Number(invoice.total) - totalPaid

  let invoice_payment_flow: "manual_wallet" | "mtn_momo_direct" | "paystack_momo" | null = null
  let manual_wallet_payment: Awaited<ReturnType<typeof getManualWalletInstructionsForInvoice>> = null

  if (invoice.status !== "paid" && remaining > 0 && invoice.business_id) {
    invoice_payment_flow = await resolvePublicInvoicePaymentFlow(supabase, invoice.business_id)
    manual_wallet_payment =
      invoice_payment_flow === "manual_wallet"
        ? await getManualWalletInstructionsForInvoice(supabase, invoiceId, { environment: "live" })
        : null
  }

  return NextResponse.json({
    invoice,
    items:    items    || [],
    payments: payments || [],
    totalPaid,
    remaining,
    invoice_payment_flow,
    manual_wallet_payment,
  })
}
