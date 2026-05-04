import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  extractBearerCashierPosToken,
  verifyCashierPosToken,
} from "@/lib/cashierPosToken.server"
import { runRetailSaleCreationEngine } from "@/lib/sales/runRetailSaleCreationEngine.server"
import { assertPosTokenSaleReferencesAllowed } from "@/lib/sales/validatePosTokenSaleRefs.server"

/**
 * Create a retail sale for PIN-only POS (no Supabase browser session).
 * Auth: Authorization: Bearer <cashier_pos_token>
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 })
    }

    const raw = extractBearerCashierPosToken(request)
    if (!raw) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const claims = verifyCashierPosToken(raw)
    if (!claims) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const isOfflineSync = request.headers.get("X-Offline-Sync") === "1"

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const cartCheck = await assertPosTokenSaleReferencesAllowed(admin, claims.businessId, body)
    if (!cartCheck.ok) {
      return cartCheck.response
    }

    return runRetailSaleCreationEngine(
      body,
      {
        mode: "token",
        businessId: claims.businessId,
        userId: claims.cashierId,
        storeId: claims.storeId,
      },
      isOfflineSync
    )
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : "Server error"
    return NextResponse.json({ error: err }, { status: 500 })
  }
}
