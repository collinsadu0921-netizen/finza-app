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

    // Binary PDF (Chromium render of the same HTML as pdf-preview)
    return NextResponse.redirect(
      new URL(`/api/invoices/${invoiceId}/export-pdf`, request.url)
    )
  } catch (error: any) {
    console.error("Error generating PDF:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

