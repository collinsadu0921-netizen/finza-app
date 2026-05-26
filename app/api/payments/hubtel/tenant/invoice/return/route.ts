/**
 * Hubtel return URL — redirect customer back to pay page; does not mark invoice paid.
 */

import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const invoiceId = request.nextUrl.searchParams.get("invoice_id")?.trim() || ""
  const token = request.nextUrl.searchParams.get("token")?.trim() || ""
  const clientReference =
    request.nextUrl.searchParams.get("clientReference")?.trim() ||
    request.nextUrl.searchParams.get("reference")?.trim() ||
    ""

  if (!invoiceId || !token) {
    return NextResponse.redirect(new URL("/", request.url))
  }

  const dest = new URL(`/pay/${encodeURIComponent(invoiceId)}`, request.url)
  dest.searchParams.set("token", token)
  dest.searchParams.set("hubtel_return", "1")
  if (clientReference) dest.searchParams.set("clientReference", clientReference)

  return NextResponse.redirect(dest)
}
