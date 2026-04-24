/**
 * GET  /api/business/inbound-email?business_id=
 * POST /api/business/inbound-email  { business_id, action?: "create" | "rotate" }
 * PATCH /api/business/inbound-email { business_id, is_active: boolean }
 *
 * Service workspace: inbound document routing address (Stage 4B).
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getUserRole } from "@/lib/userRoles"
import { canEditBusinessWideSensitiveSettings } from "@/lib/retail/retailSensitiveSettingsEditors"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import {
  createInboundRouteForBusiness,
  fetchInboundRouteForBusiness,
  getConfiguredInboundEmailDomain,
  rotateInboundRouteForBusiness,
  setInboundRouteActiveForBusiness,
} from "@/lib/businessInboundEmail/inboundEmailRouteManagement"

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status })
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return jsonError("Unauthorized", 401)

    const businessId = request.nextUrl.searchParams.get("business_id")?.trim() ?? ""
    if (!businessId) {
      return jsonError("business_id query parameter is required", 400)
    }

    const denied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user.id,
      businessId,
      minTier: "starter",
    })
    if (denied) return denied

    const domain = getConfiguredInboundEmailDomain()
    const route = await fetchInboundRouteForBusiness(supabase, businessId)

    return NextResponse.json({
      domain_configured: !!domain,
      domain: domain ?? null,
      route,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[api/business/inbound-email] GET", e)
    return jsonError(msg || "Internal error", 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return jsonError("Unauthorized", 401)

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return jsonError("Invalid JSON body", 400)
    }

    const businessId = typeof body.business_id === "string" ? body.business_id.trim() : ""
    const actionRaw = typeof body.action === "string" ? body.action.trim().toLowerCase() : "create"
    const action = actionRaw === "rotate" ? "rotate" : "create"

    if (!businessId) {
      return jsonError("business_id is required", 400)
    }

    const denied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user.id,
      businessId,
      minTier: "starter",
    })
    if (denied) return denied

    const role = await getUserRole(supabase, user.id, businessId)
    if (!canEditBusinessWideSensitiveSettings(role)) {
      return jsonError("Forbidden: only owners and admins can manage the inbound email address", 403)
    }

    const domain = getConfiguredInboundEmailDomain()
    if (!domain) {
      return jsonError(
        "Inbound email is not configured on this server (FINZA_INBOUND_EMAIL_DOMAIN).",
        503,
        { code: "INBOUND_DOMAIN_NOT_CONFIGURED" }
      )
    }

    if (action === "rotate") {
      const result = await rotateInboundRouteForBusiness(supabase, businessId, domain)
      if ("error" in result) {
        const status = result.error.includes("No inbound address") ? 400 : 500
        return jsonError(result.error, status)
      }
      return NextResponse.json({ route: result.row, rotated: true })
    }

    const result = await createInboundRouteForBusiness(supabase, businessId, domain)
    if ("error" in result) {
      return jsonError(result.error, 500)
    }
    return NextResponse.json({ route: result.row, created: result.created })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[api/business/inbound-email] POST", e)
    return jsonError(msg || "Internal error", 500)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return jsonError("Unauthorized", 401)

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return jsonError("Invalid JSON body", 400)
    }

    const businessId = typeof body.business_id === "string" ? body.business_id.trim() : ""
    if (!businessId) {
      return jsonError("business_id is required", 400)
    }

    if (typeof body.is_active !== "boolean") {
      return jsonError("is_active boolean is required", 400)
    }

    const denied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user.id,
      businessId,
      minTier: "starter",
    })
    if (denied) return denied

    const role = await getUserRole(supabase, user.id, businessId)
    if (!canEditBusinessWideSensitiveSettings(role)) {
      return jsonError("Forbidden: only owners and admins can change inbound email status", 403)
    }

    const result = await setInboundRouteActiveForBusiness(supabase, businessId, body.is_active)
    if ("error" in result) {
      const status = result.error.includes("No inbound address") ? 400 : 500
      return jsonError(result.error, status)
    }

    return NextResponse.json({ route: result.row })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[api/business/inbound-email] PATCH", e)
    return jsonError(msg || "Internal error", 500)
  }
}
