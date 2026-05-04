import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { runRetailSaleCreationEngine } from "@/lib/sales/runRetailSaleCreationEngine.server"

export async function POST(request: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "Service role key required for stock movements" },
        { status: 500 }
      )
    }

    const isOfflineSync = request.headers.get("X-Offline-Sync") === "1"

    const serverClient = await createSupabaseServerClient()
    const {
      data: { user: authUser },
    } = await serverClient.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(serverClient, authUser.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const body = await request.json()

    return runRetailSaleCreationEngine(
      body,
      { mode: "session", businessId: business.id, userId: authUser.id },
      isOfflineSync
    )
  } catch (error: unknown) {
    const err = error as Error
    console.error("Error in sales/create route:", err)
    console.error("Error stack:", err.stack)
    return NextResponse.json(
      {
        error: err.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? err.stack : undefined,
      },
      { status: 500 }
    )
  }
}
