/**
 * Public invoice API — **no authentication**; access requires a matching `public_token`.
 *
 * Capability: `invoiceId` (UUID) **and** `public_token` must match the same row.
 * Token may be supplied as:
 *   - Query: `?token=<public_token>`
 *   - Header: `x-invoice-public-token: <public_token>`
 *
 * Used by legacy `/pay/[invoiceId]?token=...` when tenant online invoice pay needs data.
 * Prefer customer-facing `/invoice-public/{public_token}` for display.
 *
 * Responses use generic errors only — no enumeration of invoice existence.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { mergeInvoiceTermsFooter } from "@/lib/invoices/loadInvoiceSettingsForDocument"
import { getManualWalletInstructionsForInvoice } from "@/lib/tenantPayments/publicInvoiceManualWallet"
import { resolvePublicInvoicePaymentFlow } from "@/lib/tenantPayments/publicInvoicePaymentFlow"
import { tenantInvoiceOnlinePaymentsEnabled } from "@/lib/payments/tenantInvoiceOnlinePayments"

export const dynamic = "force-dynamic"

const INVOICE_NOT_FOUND = NextResponse.json({ error: "Invoice not found" }, { status: 404 })

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

function readPublicToken(request: NextRequest): string | null {
  const rawQ = request.nextUrl.searchParams.get("token")
  if (rawQ != null && String(rawQ).trim() !== "") {
    try {
      const t = decodeURIComponent(String(rawQ).trim())
      return t || null
    } catch {
      return String(rawQ).trim() || null
    }
  }
  const h = request.headers.get("x-invoice-public-token")
  if (h != null && String(h).trim() !== "") return String(h).trim()
  return null
}

function isNonPublicInvoiceStatus(status: string | null | undefined): boolean {
  const s = String(status || "")
    .trim()
    .toLowerCase()
  return s === "draft" || s === "cancelled" || s === "void"
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  const { id: invoiceId } = await Promise.resolve(params)

  if (!invoiceId || !String(invoiceId).trim()) {
    return INVOICE_NOT_FOUND
  }

  const publicToken = readPublicToken(request)
  if (!publicToken) {
    return INVOICE_NOT_FOUND
  }

  try {
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
      .eq("public_token", publicToken)
      .is("deleted_at", null)
      .maybeSingle()

    if (invErr || !invoice) {
      return INVOICE_NOT_FOUND
    }

    if (isNonPublicInvoiceStatus(invoice.status)) {
      return INVOICE_NOT_FOUND
    }

    const { data: invoiceSettingsRow } = await supabase
      .from("invoice_settings")
      .select(
        "bank_name, bank_branch, bank_swift, bank_iban, bank_account_name, bank_account_number, momo_provider, momo_name, momo_number, default_payment_terms, default_footer_message"
      )
      .eq("business_id", invoice.business_id)
      .maybeSingle()

    const merged = mergeInvoiceTermsFooter(invoice.payment_terms, invoice.footer_message, {
      default_payment_terms: invoiceSettingsRow?.default_payment_terms ?? null,
      default_footer_message: invoiceSettingsRow?.default_footer_message ?? null,
    })

    const invoiceForClient = {
      ...invoice,
      payment_terms: merged.payment_terms,
      footer_message: merged.footer_message,
    }

    const invoice_settings_public = invoiceSettingsRow
      ? {
          bank_name: invoiceSettingsRow.bank_name ?? null,
          bank_branch: invoiceSettingsRow.bank_branch ?? null,
          bank_swift: invoiceSettingsRow.bank_swift ?? null,
          bank_iban: invoiceSettingsRow.bank_iban ?? null,
          bank_account_name: invoiceSettingsRow.bank_account_name ?? null,
          bank_account_number: invoiceSettingsRow.bank_account_number ?? null,
          momo_provider: invoiceSettingsRow.momo_provider ?? null,
          momo_name: invoiceSettingsRow.momo_name ?? null,
          momo_number: invoiceSettingsRow.momo_number ?? null,
          payment_terms: merged.payment_terms,
          footer_message: merged.footer_message,
        }
      : {
          bank_name: null,
          bank_branch: null,
          bank_swift: null,
          bank_iban: null,
          bank_account_name: null,
          bank_account_number: null,
          momo_provider: null,
          momo_name: null,
          momo_number: null,
          payment_terms: merged.payment_terms,
          footer_message: merged.footer_message,
        }

    const { data: items } = await supabase
      .from("invoice_items")
      .select("id, description, qty, unit_price, discount_amount, line_subtotal")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true })

    const { data: payments } = await supabase
      .from("payments")
      .select("id, amount, wht_amount, date, method, notes, reference, public_token")
      .eq("invoice_id", invoiceId)
      .is("deleted_at", null)
      .order("date", { ascending: false })

    const totalPaid = (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0)
    const remaining = Number(invoice.total) - totalPaid

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
      invoice: invoiceForClient,
      items: items || [],
      payments: payments || [],
      totalPaid,
      remaining,
      invoice_payment_flow,
      manual_wallet_payment,
      invoice_settings_public,
      tenant_invoice_online_payments_enabled: tenantInvoiceOnlinePaymentsEnabled(),
    })
  } catch {
    return NextResponse.json({ error: "Unable to load invoice" }, { status: 500 })
  }
}
