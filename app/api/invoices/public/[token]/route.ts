import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { mergeInvoiceTermsFooter } from "@/lib/invoices/loadInvoiceSettingsForDocument"
import { invoiceCustomerStatusLabel } from "@/lib/invoices/invoiceCustomerPaymentDisplay"
import { fetchInvoiceBalanceDuePublic } from "@/lib/invoices/invoicePublicBalanceDue"
import { resolvePublicInvoicePaymentFlow } from "@/lib/tenantPayments/publicInvoicePaymentFlow"
import { tenantInvoiceOnlinePaymentsEnabled } from "@/lib/payments/tenantInvoiceOnlinePayments"
import {
  PUBLIC_BUSINESS_SELECT,
  PUBLIC_INVOICE_SELECT_WITH_CUSTOMER,
  PUBLIC_INVOICE_SETTINGS_SELECT,
  PUBLIC_INVOICE_ITEM_SELECT,
} from "@/lib/publicDocuments/publicDocumentSelects"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token: rawToken } = await params
    const token = decodeURIComponent((rawToken || "").trim())

    const supabase = createSupabaseAdminClient()

    if (!token) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    const sel = PUBLIC_INVOICE_SELECT_WITH_CUSTOMER.replace(/\s+/g, " ").trim()
    const { data: invoice, error: invoiceError } = (await supabase
      .from("invoices")
      .select(sel)
      .eq("public_token", token)
      .is("deleted_at", null)
      .single()) as { data: Record<string, unknown> | null; error: { message?: string } | null }

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    const inv = invoice as Record<string, unknown> & {
      id: string
      business_id: string
      status?: string | null
      total?: unknown
      payment_terms?: string | null
      footer_message?: string | null
    }

    const st = String(inv.status || "")
      .trim()
      .toLowerCase()
    if (st === "cancelled" || st === "void" || st === "draft") {
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select(PUBLIC_BUSINESS_SELECT)
      .eq("id", inv.business_id)
      .single()

    if (businessError) {
      console.error("Error fetching business:", businessError)
    }

    const { data: settings, error: settingsError } = await supabase
      .from("invoice_settings")
      .select(PUBLIC_INVOICE_SETTINGS_SELECT)
      .eq("business_id", inv.business_id)
      .maybeSingle()

    if (settingsError) {
      console.error("Error fetching invoice settings:", settingsError)
    }

    const { data: items, error: itemsError } = await supabase
      .from("invoice_items")
      .select(PUBLIC_INVOICE_ITEM_SELECT)
      .eq("invoice_id", inv.id)
      .order("created_at", { ascending: true })

    if (itemsError) {
      console.error("Error fetching invoice items:", itemsError)
    }

    const merged = mergeInvoiceTermsFooter(
      inv.payment_terms,
      inv.footer_message,
      {
        default_payment_terms: settings?.default_payment_terms ?? null,
        default_footer_message: settings?.default_footer_message ?? null,
      }
    )

    const invoiceForClient = {
      ...inv,
      payment_terms: merged.payment_terms,
      footer_message: merged.footer_message,
    }

    const balanceDue = await fetchInvoiceBalanceDuePublic(
      supabase,
      inv.id,
      Number(inv.total ?? 0)
    )

    let invoice_payment_flow: Awaited<ReturnType<typeof resolvePublicInvoicePaymentFlow>> | null = null
    if (balanceDue > 0 && inv.business_id) {
      invoice_payment_flow = await resolvePublicInvoicePaymentFlow(supabase, inv.business_id)
    }

    return NextResponse.json({
      invoice: invoiceForClient,
      business: business || null,
      settings: settings || null,
      items: items || [],
      paymentSummary: {
        balanceDue,
        statusLabel: invoiceCustomerStatusLabel(inv.status),
      },
      tenant_invoice_online_payments_enabled: tenantInvoiceOnlinePaymentsEnabled(),
      invoice_payment_flow,
    })
  } catch (error: unknown) {
    console.error("Error fetching public invoice:", error)
    return NextResponse.json({ error: "Unable to load document" }, { status: 500 })
  }
}
