import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { generateFinancialDocumentHTML, type BusinessInfo, type CustomerInfo, type DocumentItem, type DocumentMeta, type DocumentTotals } from "@/components/documents/FinancialDocument"
import { getCurrencySymbol } from "@/lib/currency"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const creditNoteId = resolvedParams.id

    if (!creditNoteId) {
      return NextResponse.json(
        { error: "Credit Note ID is required" },
        { status: 400 }
      )
    }

    const supabase = await createSupabaseServerClient()

    // Fetch credit note with all related data
    const { data: creditNote, error: creditNoteError } = await supabase
      .from("credit_notes")
      .select(`
        id, business_id, invoice_id, credit_number, date, reason, subtotal, nhil, getfund, covid, vat, total_tax, total, status, notes, public_token, created_at, updated_at, deleted_at, tax_lines, tax_engine_code, tax_engine_effective_from, tax_jurisdiction,
        invoices (
          id,
          invoice_number,
          customers (
            id,
            name,
            email,
            phone,
            whatsapp_phone,
            address
          )
        ),
        businesses (
          id,
          name,
          legal_name,
          trading_name,
          phone,
          email,
          address,
          logo_url,
          tax_id,
          registration_number
        ),
        credit_note_items (
          id,
          description,
          qty,
          unit_price,
          discount_amount,
          line_subtotal
        )
      `)
      .eq("id", creditNoteId)
      .is("deleted_at", null)
      .single()

    if (creditNoteError || !creditNote) {
      return NextResponse.json(
        { error: "Credit note not found" },
        { status: 404 }
      )
    }

    // Get customer from linked invoice or directly (Supabase may type nested relations as array)
    const invoiceRel = Array.isArray((creditNote as any).invoices) ? (creditNote as any).invoices[0] : (creditNote as any).invoices
    const businessRel = Array.isArray((creditNote as any).businesses) ? (creditNote as any).businesses[0] : (creditNote as any).businesses
    const customer = invoiceRel?.customers || null

    // Prepare data for shared document component
    const business: BusinessInfo = {
      name: businessRel?.name,
      legal_name: businessRel?.legal_name,
      trading_name: businessRel?.trading_name,
      phone: businessRel?.phone,
      email: businessRel?.email,
      address: businessRel?.address,
      logo_url: businessRel?.logo_url,
      tax_id: businessRel?.tax_id,
      registration_number: businessRel?.registration_number,
    }

    const customerData: CustomerInfo = customer
      ? {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          whatsapp_phone: customer.whatsapp_phone,
          address: customer.address,
        }
      : {
          name: "Customer",
        }

    const documentItems: DocumentItem[] = (creditNote.credit_note_items || []).map((item: any) => ({
      id: item.id,
      description: item.description || "Item",
      qty: item.qty || 0,
      unit_price: item.unit_price || 0,
      discount_amount: Number(item.discount_amount) || 0,
      line_subtotal: Number(item.line_subtotal ?? 0),
    }))

    const cn = creditNote as Record<string, unknown>
    const documentTotals: DocumentTotals = {
      subtotal: Number(cn.subtotal || 0),
      total_tax: Number(cn.total_tax || 0),
      total: Number((cn as any).total_amount ?? cn.total ?? 0),
    }

    const documentMeta: DocumentMeta = {
      document_number: ((cn as any).credit_note_number ?? cn.credit_number ?? (cn.id as string).substring(0, 8).toUpperCase()) as string,
      issue_date: String((cn as any).issue_date ?? cn.date ?? cn.created_at ?? ""),
      status: (cn.status as string) || null,
    }

    // Generate HTML using shared document component
    const htmlPreview = generateFinancialDocumentHTML({
      documentType: "credit_note",
      business,
      customer: customerData,
      items: documentItems,
      totals: documentTotals,
      meta: documentMeta,
      notes: creditNote.notes || null,
      footer_message: null,
      apply_taxes: false, // Credit notes typically don't show tax breakdown
      // CRITICAL: No hardcoded fallbacks - use getCurrencySymbol if currency_code exists
      currency_symbol: (cn as any).currency_code
        ? getCurrencySymbol((cn as any).currency_code) || (cn as any).currency_symbol || null
        : (cn as any).currency_symbol || null,
      currency_code: (cn as any).currency_code || null,
    })

    return new NextResponse(htmlPreview, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    })
  } catch (error: any) {
    console.error("Error generating credit note preview:", error)
    return NextResponse.json(
      { error: "Failed to generate preview" },
      { status: 500 }
    )
  }
}

