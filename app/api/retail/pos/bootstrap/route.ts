import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  extractBearerCashierPosToken,
  verifyCashierPosToken,
} from "@/lib/cashierPosToken.server"
import { loadPosBootstrapPayload } from "@/lib/retail/posBootstrapData.server"

/**
 * POS catalog + register bootstrap for PIN-only cashiers (no Supabase browser session).
 * Auth: Authorization: Bearer <cashier_pos_token> from POST /api/auth/pin-login
 */
export async function GET(request: NextRequest) {
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

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const result = await loadPosBootstrapPayload(admin, claims)
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: result.status })
    }

    return NextResponse.json(result.payload)
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
