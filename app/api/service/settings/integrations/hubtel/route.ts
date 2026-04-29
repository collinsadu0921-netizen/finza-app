import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import {
  getTenantHubtelConnections,
  upsertTenantHubtelConnection,
} from "@/lib/payments/hubtel/tenantConnectionService"

export const dynamic = "force-dynamic"

function parseEnvironment(raw: unknown): "test" | "live" {
  return raw === "live" ? "live" : "test"
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      searchParams.get("business_id") ?? searchParams.get("businessId")
    )
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const rows = await getTenantHubtelConnections(supabase, scope.businessId)
    return NextResponse.json({
      business_id: scope.businessId,
      connections: rows,
      statuses: ["not_connected", "pending_verification", "connected", "failed", "disconnected"],
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load Hubtel integration" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = (await request.json()) as Record<string, unknown>
    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      typeof body.business_id === "string" ? body.business_id : null
    )
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const merchantNumber = typeof body.merchant_number === "string" ? body.merchant_number.trim() : ""
    if (!merchantNumber) {
      return NextResponse.json({ error: "merchant_number is required" }, { status: 400 })
    }

    const connection = await upsertTenantHubtelConnection(supabase, {
      businessId: scope.businessId,
      merchantNumber,
      environment: parseEnvironment(body.environment),
      businessDisplayName:
        typeof body.business_display_name === "string" ? body.business_display_name.trim() : null,
    })

    return NextResponse.json({
      business_id: scope.businessId,
      connection,
      message: "Hubtel connection saved as pending verification.",
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save Hubtel integration" },
      { status: 500 }
    )
  }
}

