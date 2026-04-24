import "server-only"

import { randomBytes } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

const LOCAL_PART_RE = /^fd[a-f0-9]{40}$/

export type BusinessInboundEmailRouteRow = {
  id: string
  business_id: string
  recipient_address: string
  is_active: boolean
  created_at: string
  updated_at: string
}

/**
 * Public inbound domain (MX target), e.g. `inbound.yourdomain.com`.
 * Server-only; set in deployment env.
 */
export function getConfiguredInboundEmailDomain(): string | null {
  const raw = process.env.FINZA_INBOUND_EMAIL_DOMAIN?.trim().toLowerCase()
  if (!raw) return null
  if (raw.includes("@") || raw.includes(" ") || raw.length < 3) return null
  return raw
}

/** Opaque, lowercase, email-safe local-part (fd + 40 hex chars). */
export function generateOpaqueInboundLocalPart(): string {
  return `fd${randomBytes(20).toString("hex")}`
}

export function composeInboundRecipientAddress(localPart: string, domain: string): string {
  const d = domain.trim().toLowerCase()
  const l = localPart.trim().toLowerCase()
  if (!LOCAL_PART_RE.test(l)) {
    throw new Error("Invalid inbound local-part shape")
  }
  return `${l}@${d}`
}

export function isValidOpaqueLocalPart(localPart: string): boolean {
  return LOCAL_PART_RE.test(localPart.trim().toLowerCase())
}

export async function fetchInboundRouteForBusiness(
  supabase: SupabaseClient,
  businessId: string
): Promise<BusinessInboundEmailRouteRow | null> {
  const { data, error } = await supabase
    .from("business_inbound_email_routes")
    .select("id, business_id, recipient_address, is_active, created_at, updated_at")
    .eq("business_id", businessId)
    .maybeSingle()

  if (error) {
    console.error("[inboundEmailRoute] fetch:", error.message)
    return null
  }
  return (data as BusinessInboundEmailRouteRow) ?? null
}

const MAX_UNIQUE_ATTEMPTS = 10

/**
 * Inserts a new route row with a globally unique recipient_address.
 */
export async function createInboundRouteForBusiness(
  supabase: SupabaseClient,
  businessId: string,
  domain: string
): Promise<{ row: BusinessInboundEmailRouteRow; created: boolean } | { error: string }> {
  const existing = await fetchInboundRouteForBusiness(supabase, businessId)
  if (existing) {
    return { row: existing, created: false }
  }

  for (let i = 0; i < MAX_UNIQUE_ATTEMPTS; i++) {
    const local = generateOpaqueInboundLocalPart()
    let address: string
    try {
      address = composeInboundRecipientAddress(local, domain)
    } catch {
      return { error: "Invalid inbound domain configuration" }
    }

    const { data, error } = await supabase
      .from("business_inbound_email_routes")
      .insert({
        business_id: businessId,
        recipient_address: address,
        is_active: true,
      })
      .select("id, business_id, recipient_address, is_active, created_at, updated_at")
      .single()

    if (!error && data) {
      return { row: data as BusinessInboundEmailRouteRow, created: true }
    }

    const raceAfterError = await fetchInboundRouteForBusiness(supabase, businessId)
    if (raceAfterError) {
      return { row: raceAfterError, created: false }
    }

    const dupRecipient =
      error?.code === "23505" ||
      String(error?.message ?? "")
        .toLowerCase()
        .includes("duplicate")
    if (dupRecipient) {
      continue
    }

    return { error: error?.message || "Failed to create inbound email route" }
  }

  return { error: "Could not allocate a unique inbound address. Try again." }
}

/**
 * Assigns a new recipient address while keeping the same row (old address stops working).
 */
export async function rotateInboundRouteForBusiness(
  supabase: SupabaseClient,
  businessId: string,
  domain: string
): Promise<{ row: BusinessInboundEmailRouteRow } | { error: string }> {
  const existing = await fetchInboundRouteForBusiness(supabase, businessId)
  if (!existing) {
    return { error: "No inbound address exists yet. Create one first." }
  }

  for (let i = 0; i < MAX_UNIQUE_ATTEMPTS; i++) {
    const local = generateOpaqueInboundLocalPart()
    let address: string
    try {
      address = composeInboundRecipientAddress(local, domain)
    } catch {
      return { error: "Invalid inbound domain configuration" }
    }

    const { data, error } = await supabase
      .from("business_inbound_email_routes")
      .update({
        recipient_address: address,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("business_id", businessId)
      .eq("id", existing.id)
      .select("id, business_id, recipient_address, is_active, created_at, updated_at")
      .single()

    if (!error && data) {
      return { row: data as BusinessInboundEmailRouteRow }
    }

    const dup =
      error?.code === "23505" ||
      String(error?.message ?? "")
        .toLowerCase()
        .includes("duplicate")
    if (dup) {
      continue
    }

    return { error: error?.message || "Failed to rotate inbound email address" }
  }

  return { error: "Could not allocate a unique inbound address. Try again." }
}

export async function setInboundRouteActiveForBusiness(
  supabase: SupabaseClient,
  businessId: string,
  isActive: boolean
): Promise<{ row: BusinessInboundEmailRouteRow } | { error: string }> {
  const existing = await fetchInboundRouteForBusiness(supabase, businessId)
  if (!existing) {
    return { error: "No inbound address exists yet." }
  }

  const { data, error } = await supabase
    .from("business_inbound_email_routes")
    .update({
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq("business_id", businessId)
    .eq("id", existing.id)
    .select("id, business_id, recipient_address, is_active, created_at, updated_at")
    .single()

  if (error || !data) {
    return { error: error?.message || "Failed to update inbound route" }
  }
  return { row: data as BusinessInboundEmailRouteRow }
}
