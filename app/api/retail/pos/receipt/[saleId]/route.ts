import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  extractBearerCashierPosToken,
  verifyCashierPosToken,
} from "@/lib/cashierPosToken.server"
import { getRetailSaleReceiptPayloadForBusiness } from "@/lib/retail/getRetailSaleReceiptPayloadForBusiness"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/**
 * Receipt payload for retail POS surface (PIN cashier token).
 * Auth: Authorization: Bearer <cashier_pos_token> from POST /api/auth/pin-login
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ saleId: string }> }
) {
  try {
    const params = await context.params
    const saleId = params.saleId
    const raw = extractBearerCashierPosToken(request)
    if (!raw) {
      return NextResponse.json({ error: "Missing or invalid authorization" }, { status: 401 })
    }

    const claims = verifyCashierPosToken(raw)
    if (!claims) {
      return NextResponse.json({ error: "Invalid or expired cashier token" }, { status: 401 })
    }

    const result = await getRetailSaleReceiptPayloadForBusiness(
      supabaseAdmin,
      saleId,
      claims.businessId,
      { expectedStoreId: claims.storeId }
    )

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({
      ...result.body,
      default_currency: result.default_currency,
      receipt_settings: result.receipt_settings,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
