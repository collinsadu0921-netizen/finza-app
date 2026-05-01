/**
 * GET /api/service/invitations
 *
 * Returns pending and active accountant engagements for the current service business.
 * Resolves business via resolveServiceBusinessContext. Uses two queries (engagements
 * then firm identity) so RLS applies correctly for pending and effective engagements.
 */

import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveServiceBusinessContext } from "@/lib/serviceBusinessContext"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

const TARGET_ENGAGEMENT_ID = "6896b6e6-50ad-441c-a4d8-972ca8f98330"
const today = () => new Date().toISOString().split("T")[0]

function isEffective(
  status: string,
  effectiveFrom: string,
  effectiveTo: string | null
): boolean {
  if (status !== "accepted" && status !== "active") return false
  const t = today()
  if (effectiveFrom > t) return false
  if (effectiveTo != null && effectiveTo < t) return false
  return true
}

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: session } = await supabase.auth.getSession()
    console.log("[INV_GET]", { userId: user?.id ?? null, sessionUserId: session?.session?.user?.id ?? null })

    // STEP 1 — Log authenticated user
    console.log("[INVITATIONS AUDIT] STEP 1 auth.uid():", user.id)
    console.log("[INVITATIONS AUDIT] STEP 1 full user object:", JSON.stringify(user, null, 2))

    const ctx = await resolveServiceBusinessContext(supabase, user.id)

    // STEP 2 — Log resolver output
    console.log("[INVITATIONS AUDIT] STEP 2 returned object:", JSON.stringify(ctx, null, 2))
    console.log("[INVITATIONS AUDIT] STEP 2 resolved businessId:", "businessId" in ctx ? ctx.businessId : null)
    console.log("[INVITATIONS AUDIT] STEP 2 error state:", "error" in ctx ? ctx.error : null)

    if ("error" in ctx) {
      return NextResponse.json(
        { businessId: null, pending: [], active: [] },
        { status: 200 }
      )
    }

    const businessId = ctx.businessId

    const denied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user.id,
      businessId,
      minTier: "starter",
    })
    if (denied) return denied

    // STEP 3 — Verify getCurrentBusiness result (inline)
    const getCurrentBusinessResult = await getCurrentBusiness(supabase, user.id)
    console.log("[INVITATIONS AUDIT] STEP 3 getCurrentBusiness result:", {
      "business.id": getCurrentBusinessResult?.id ?? null,
      "business.name": getCurrentBusinessResult?.name ?? null,
      "business.owner_id": getCurrentBusinessResult?.owner_id ?? null,
    })

    const { data: rows, error: engError } = await supabase
      .from("firm_client_engagements")
      .select(
        "id, accounting_firm_id, status, access_level, effective_from, effective_to, created_at, accepted_at"
      )
      .eq("client_business_id", businessId)

    // STEP 4 — Log engagement query RAW result (before any mapping or filtering)
    console.log("[INVITATIONS AUDIT] STEP 4 engagements RAW data:", JSON.stringify(rows, null, 2))
    console.log("[INVITATIONS AUDIT] STEP 4 engagements RAW error:", engError)

    if (engError) {
      console.error("Service invitations engagements error:", engError)
      return NextResponse.json(
        { error: engError.message || "Failed to load invitations" },
        { status: 500 }
      )
    }

    const list = rows ?? []

    // TEMP FORENSIC: compare identity + count with PATCH (remove after diagnosis)
    console.log("[INVITATIONS GET FORENSIC] user.id:", user.id, "resolvedBusinessId:", businessId, "engagementCount:", list.length)

    // STEP 5 — Log RLS visibility (same client: row returned or blocked by RLS)
    const { data: targetRow, error: targetError } = await supabase
      .from("firm_client_engagements")
      .select("*")
      .eq("id", TARGET_ENGAGEMENT_ID)
      .maybeSingle()
    console.log("[INVITATIONS AUDIT] STEP 5 RLS visibility — target engagement by id:", {
      rowReturned: targetRow != null,
      row: targetRow,
      error: targetError,
    })

    const firmIds = [...new Set(list.map((r: { accounting_firm_id: string }) => r.accounting_firm_id))]
    let firmMap: Record<string, { name: string; contact_email: string | null }> = {}

    if (firmIds.length > 0) {
      const { data: firms, error: firmError } = await supabase
        .from("accounting_firms")
        .select("id, name, contact_email")
        .in("id", firmIds)

      if (firmError) {
        console.error("Service invitations firms error:", firmError)
        return NextResponse.json(
          { error: firmError.message || "Failed to load firm details" },
          { status: 500 }
        )
      }
      // STEP 7 — Log accounting_firms join result
      console.log("[INVITATIONS AUDIT] STEP 7 accounting_firms (id, name, contact_email):", JSON.stringify(firms ?? [], null, 2))
      firmMap = (firms ?? []).reduce(
        (acc: Record<string, { name: string; contact_email: string | null }>, f: { id: string; name: string | null; contact_email: string | null }) => {
          acc[f.id] = { name: f.name ?? "Unknown firm", contact_email: f.contact_email ?? null }
          return acc
        },
        {}
      )
    }

    // STEP 6 — Log rows BEFORE pending split (confirm engagement appears in list prior to split)
    console.log("[INVITATIONS AUDIT] STEP 6 list BEFORE pending/active split:", JSON.stringify(list, null, 2))

    const pending: Array<{
      id: string
      accounting_firm_id: string
      firm_name: string
      firm_contact_email: string | null
      access_level: string
      effective_from: string
      effective_to: string | null
      created_at: string
    }> = []
    const active: Array<{
      id: string
      accounting_firm_id: string
      firm_name: string
      firm_contact_email: string | null
      access_level: string
      effective_from: string
      effective_to: string | null
      accepted_at: string | null
    }> = []

    for (const row of list) {
      const firm = firmMap[row.accounting_firm_id] ?? { name: "Unknown firm", contact_email: null }
      const base = {
        id: row.id,
        accounting_firm_id: row.accounting_firm_id,
        firm_name: firm.name,
        firm_contact_email: firm.contact_email,
        access_level: row.access_level,
        effective_from: row.effective_from,
        effective_to: row.effective_to,
      }
      if (row.status === "pending") {
        pending.push({ ...base, created_at: row.created_at })
      } else if (isEffective(row.status, row.effective_from, row.effective_to)) {
        active.push({ ...base, accepted_at: row.accepted_at })
      }
    }

    // OUTPUT FORMAT
    const containsTargetEngagement = list.some((r: { id: string }) => r.id === TARGET_ENGAGEMENT_ID)
    const accountingFirmVisible = firmIds.length === 0 || (Object.keys(firmMap).length > 0)
    console.log("[INVITATIONS AUDIT] OUTPUT:", JSON.stringify({
      userId: user.id,
      resolvedBusinessId: businessId,
      getCurrentBusinessResult: getCurrentBusinessResult
        ? { id: getCurrentBusinessResult.id, name: getCurrentBusinessResult.name, owner_id: getCurrentBusinessResult.owner_id }
        : null,
      engagementsReturned: list.length,
      containsTargetEngagement,
      accountingFirmVisible,
    }, null, 2))

    return NextResponse.json({
      businessId,
      pending,
      active,
    })
  } catch (err: unknown) {
    console.error("Service invitations error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    )
  }
}
