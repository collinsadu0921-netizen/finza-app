/**
 * POST /api/assets/[id]/depreciation  — post depreciation (atomic RPC)
 * GET  /api/assets/[id]/depreciation  — list depreciation entries
 * DELETE /api/assets/[id]/depreciation — soft-delete only unposted draft rows (legacy)
 */
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { enforceServiceIndustryMinTierWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { mapDepreciationRpcError } from "@/lib/assets/depreciationApiErrors"
import { normalizeDepreciationPostingDate } from "@/lib/assets/depreciationAmount"
import type { DepreciationPostResult } from "@/lib/assets/depreciationAmount"

async function resolveAndEnforce(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, user: { id: string } | null) {
  if (!user) return { denied: NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 }) }
  const business = await getCurrentBusiness(supabase, user.id)
  if (!business) return { denied: NextResponse.json({ error: "Business not found", code: "BUSINESS_NOT_FOUND" }, { status: 404 }) }
  const denied = await enforceServiceIndustryMinTierWrite(
    supabase,
    user.id,
    business.id,
    "professional"
  )
  if (denied) return { denied }
  return { business, userId: user.id }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const assetId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { denied, business } = await resolveAndEnforce(supabase, user)
    if (denied) return denied

    const { data: asset } = await supabase
      .from("assets").select("id").eq("id", assetId).eq("business_id", business!.id).maybeSingle()
    if (!asset) return NextResponse.json({ error: "Asset not found", code: "ASSET_NOT_FOUND" }, { status: 404 })

    const { data: entries, error } = await supabase
      .from("depreciation_entries")
      .select("*")
      .eq("asset_id", assetId)
      .is("deleted_at", null)
      .order("date", { ascending: false })

    if (error) return NextResponse.json({ error: error.message, code: "FETCH_FAILED" }, { status: 500 })
    return NextResponse.json({ entries: entries || [] })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message, code: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const assetId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    const resolved = await resolveAndEnforce(supabase, user)
    if ("denied" in resolved && resolved.denied) return resolved.denied
    const { business, userId } = resolved as { business: { id: string }; userId: string }

    const body = await request.json()
    const { date, amount, adjustment_reason, idempotency_key } = body as {
      date?: string
      amount?: number | null
      adjustment_reason?: string | null
      idempotency_key?: string | null
    }

    if (!date) {
      return NextResponse.json(
        { error: "Posting date is required", code: "VALIDATION_ERROR" },
        { status: 400 }
      )
    }

    const { data: asset } = await supabase
      .from("assets")
      .select("id")
      .eq("id", assetId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .maybeSingle()

    if (!asset) {
      return NextResponse.json({ error: "Asset not found", code: "ASSET_NOT_FOUND" }, { status: 404 })
    }

    const postingDate = normalizeDepreciationPostingDate(date)

    const { data: rpcResult, error: rpcError } = await supabase.rpc("post_asset_depreciation", {
      p_asset_id: assetId,
      p_posting_date: postingDate,
      p_amount: amount != null ? Number(amount) : null,
      p_adjustment_reason: adjustment_reason ?? null,
      p_idempotency_key: idempotency_key ?? null,
      p_posted_by: userId,
    })

    if (rpcError) {
      const mapped = mapDepreciationRpcError(rpcError.message)
      return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status })
    }

    if (!rpcResult || typeof rpcResult !== "object") {
      return NextResponse.json(
        { error: "Depreciation posting failed", code: "DEPRECIATION_POST_FAILED" },
        { status: 500 }
      )
    }

    const result = rpcResult as DepreciationPostResult

    if (!result.depreciation_entry_id || !result.journal_entry_id) {
      return NextResponse.json(
        { error: "Depreciation posting returned incomplete result", code: "DEPRECIATION_POST_FAILED" },
        { status: 500 }
      )
    }

    await createAuditLog({
      businessId: business.id,
      userId,
      actionType: "asset.depreciation.posted",
      entityType: "depreciation_entry",
      entityId: result.depreciation_entry_id,
      newValues: {
        asset_id: assetId,
        amount: result.amount,
        posting_date: result.posting_date,
        journal_entry_id: result.journal_entry_id,
        status: result.status,
        adjustment_reason: adjustment_reason ?? null,
        idempotent: result.idempotent ?? false,
      },
      request,
    })

    return NextResponse.json(
      {
        entry: result,
        depreciation_entry_id: result.depreciation_entry_id,
        journal_entry_id: result.journal_entry_id,
        idempotent: result.idempotent ?? false,
      },
      { status: result.idempotent ? 200 : 201 }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("Error posting depreciation:", err)
    return NextResponse.json({ error: message, code: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const assetId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    const resolved = await resolveAndEnforce(supabase, user)
    if ("denied" in resolved && resolved.denied) return resolved.denied
    const { business } = resolved as { business: { id: string } }

    const { data: asset } = await supabase
      .from("assets").select("id").eq("id", assetId).eq("business_id", business.id).maybeSingle()
    if (!asset) return NextResponse.json({ error: "Asset not found", code: "ASSET_NOT_FOUND" }, { status: 404 })

    const { searchParams } = new URL(request.url)
    const entryId = searchParams.get("entry_id")
    if (!entryId) {
      return NextResponse.json({ error: "entry_id is required", code: "VALIDATION_ERROR" }, { status: 400 })
    }

    const { data: entry } = await supabase
      .from("depreciation_entries")
      .select("id, journal_entry_id, status")
      .eq("id", entryId)
      .eq("asset_id", assetId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .maybeSingle()

    if (!entry) {
      return NextResponse.json({ error: "Depreciation entry not found", code: "ENTRY_NOT_FOUND" }, { status: 404 })
    }

    if (entry.journal_entry_id || (entry.status && ["posted", "adjusted", "reversed", "reversal"].includes(entry.status))) {
      return NextResponse.json(
        {
          error: "Posted depreciation cannot be deleted. Use reverse instead.",
          code: "DELETE_NOT_ALLOWED",
        },
        { status: 403 }
      )
    }

    const { error } = await supabase
      .from("depreciation_entries")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", entryId)
      .eq("asset_id", assetId)

    if (error) {
      return NextResponse.json({ error: error.message, code: "DELETE_FAILED" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message, code: "INTERNAL_ERROR" }, { status: 500 })
  }
}
