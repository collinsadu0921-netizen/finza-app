import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getRetailSaleReceiptPayloadForBusiness } from "@/lib/retail/getRetailSaleReceiptPayloadForBusiness"
import { requireRetailSalesReader } from "@/lib/retail/requireRetailSalesReader"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params
    const saleId = params.id
    const businessId = request.nextUrl.searchParams.get("business_id")
    const reader = await requireRetailSalesReader(request, businessId, "receipt")
    if (!reader.ok) return reader.response

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const result = await getRetailSaleReceiptPayloadForBusiness(
      supabase,
      saleId,
      reader.businessId,
      {}
    )

    if (!result.ok) {
      const payload: Record<string, unknown> = { error: result.error }
      if (result.status === 404) payload.code = "SALE_NOT_FOUND"
      return NextResponse.json(payload, { status: result.status })
    }

    return NextResponse.json(result.body)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
