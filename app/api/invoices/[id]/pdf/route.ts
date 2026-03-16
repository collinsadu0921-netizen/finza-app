import { NextRequest, NextResponse } from "next/server"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const invoiceId = resolvedParams.id

    if (!invoiceId) {
      return NextResponse.json(
        { error: "Invoice ID is required" },
        { status: 400 }
      )
    }

    // Redirect to PDF preview endpoint that uses the shared document component
    // TODO: In the future, convert HTML to actual PDF using a library like pdfkit or puppeteer
    return NextResponse.redirect(
      new URL(`/api/invoices/${invoiceId}/pdf-preview`, request.url)
    )
  } catch (error: any) {
    console.error("Error generating PDF:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

