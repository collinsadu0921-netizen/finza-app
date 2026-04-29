import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

export type HubtelConnectionStatus =
  | "not_connected"
  | "pending_verification"
  | "connected"
  | "failed"
  | "disconnected"

export type TenantHubtelConnectionView = {
  business_id: string
  provider: "hubtel"
  merchant_number: string
  environment: "test" | "live"
  status: Exclude<HubtelConnectionStatus, "not_connected">
  business_display_name: string | null
  updated_at: string
}

function toStatus(value: string | null | undefined): Exclude<HubtelConnectionStatus, "not_connected"> {
  if (value === "pending_verification" || value === "connected" || value === "failed" || value === "disconnected") {
    return value
  }
  return "pending_verification"
}

export async function getTenantHubtelConnections(
  supabase: SupabaseClient,
  businessId: string
): Promise<TenantHubtelConnectionView[]> {
  const { data, error } = await supabase
    .from("tenant_hubtel_connections")
    .select("business_id, provider, merchant_number, environment, status, metadata, updated_at")
    .eq("business_id", businessId)
    .eq("provider", "hubtel")
    .order("environment", { ascending: true })

  if (error) throw new Error(error.message || "Failed to load Hubtel connection")
  return (data ?? []).map((row) => {
    const meta = (row.metadata ?? {}) as Record<string, unknown>
    return {
      business_id: String(row.business_id),
      provider: "hubtel",
      merchant_number: String(row.merchant_number ?? ""),
      environment: (row.environment === "live" ? "live" : "test") as "test" | "live",
      status: toStatus(row.status as string | null),
      business_display_name:
        typeof meta.business_display_name === "string" && meta.business_display_name.trim()
          ? meta.business_display_name.trim()
          : null,
      updated_at: String(row.updated_at ?? new Date().toISOString()),
    }
  })
}

export async function upsertTenantHubtelConnection(
  supabase: SupabaseClient,
  params: {
    businessId: string
    merchantNumber: string
    environment: "test" | "live"
    businessDisplayName?: string | null
  }
): Promise<TenantHubtelConnectionView> {
  const merchantNumber = params.merchantNumber.trim()
  if (!merchantNumber) throw new Error("Merchant number is required")

  const metadata: Record<string, unknown> = {}
  if (params.businessDisplayName && params.businessDisplayName.trim()) {
    metadata.business_display_name = params.businessDisplayName.trim()
  }

  const { data, error } = await supabase
    .from("tenant_hubtel_connections")
    .upsert(
      {
        business_id: params.businessId,
        provider: "hubtel",
        merchant_number: merchantNumber,
        environment: params.environment,
        status: "pending_verification",
        metadata,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id,environment" }
    )
    .select("business_id, provider, merchant_number, environment, status, metadata, updated_at")
    .single()

  if (error || !data) throw new Error(error?.message || "Failed to save Hubtel connection")

  const meta = (data.metadata ?? {}) as Record<string, unknown>
  return {
    business_id: String(data.business_id),
    provider: "hubtel",
    merchant_number: String(data.merchant_number ?? ""),
    environment: (data.environment === "live" ? "live" : "test") as "test" | "live",
    status: toStatus(data.status as string | null),
    business_display_name:
      typeof meta.business_display_name === "string" && meta.business_display_name.trim()
        ? meta.business_display_name.trim()
        : null,
    updated_at: String(data.updated_at ?? new Date().toISOString()),
  }
}

