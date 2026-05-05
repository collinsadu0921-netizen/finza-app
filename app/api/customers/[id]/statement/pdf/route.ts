import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { renderHtmlToPdfBuffer } from "@/lib/pdf/renderHtmlToPdf"
import { buildCustomerStatementData } from "@/lib/statements/buildCustomerStatementData"
import { buildCustomerStatementPdfHtml } from "@/lib/statements/buildCustomerStatementPdfHtml"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

function sanitizeFilePart(value: string): string {
  return value
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60)
}
function contentDisposition(filename: string): string {
  const asciiOnly = /^[\x20-\x7e]+$/.test(filename)
  const escaped = filename.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  if (asciiOnly) return `attachment; filename="${escaped}"`
  return `attachment; filename="${escaped.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")

    const statement = await buildCustomerStatementData({
      supabase,
      businessId: business.id,
      customerId: id,
      filters: { startDate, endDate },
    })

    const { data: businessProfile } = await supabase
      .from("businesses")
      .select("name, legal_name, trading_name, phone, email, address, logo_url, default_currency")
      .eq("id", business.id)
      .single()

    const html = buildCustomerStatementPdfHtml({
      business: businessProfile,
      customer: statement.customer,
      invoices: statement.invoices,
      payments: statement.payments,
      creditNotes: statement.creditNotes,
      summary: statement.summary,
      transactions: statement.transactions,
      startDate,
      endDate,
      generatedAt: new Date(),
    })

    const pdf = await renderHtmlToPdfBuffer(html)
    const fallbackId = sanitizeFilePart(statement.customer?.id || id).slice(0, 8)
    const customerPart = sanitizeFilePart(statement.customer?.name || "") || fallbackId
    const filename = `customer-statement-${customerPart}.pdf`

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(filename),
        "Cache-Control": "no-store",
      },
    })
  } catch (error: any) {
    if (error?.status === 404) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 })
    }
    console.error("Error generating customer statement PDF:", error)
    return NextResponse.json(
      { error: error?.message || "Failed to generate statement PDF" },
      { status: 500 }
    )
  }
}
