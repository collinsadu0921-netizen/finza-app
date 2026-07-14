import { NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { enforceServiceIndustryMinTierWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import {
  mapDisposalRpcError,
  type DisposalPostResult,
} from "@/lib/assets/disposalApiErrors"
import {
  carryingValue,
  normalizeDisposalProceeds,
  validateDisposalInput,
  type DisposalType,
} from "@/lib/assets/disposalAmount"

async function resolveAndEnforce(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, user: { id: string } | null) {
  if (!user) return { denied: NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 }) }
  const business = await getCurrentBusiness(supabase, user.id)
  if (!business) return { denied: NextResponse.json({ error: "Business not found", code: "BUSINESS_NOT_FOUND" }, { status: 404 }) }
  const denied = await enforceServiceIndustryMinTierWrite(supabase, user.id, business.id, "professional")
  if (denied) return { denied }
  return { business, userId: user.id }
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
    const {
      disposal_date,
      disposal_type = "cash",
      proceeds,
      disposal_amount,
      payment_account_id,
      reason,
      idempotency_key,
      disposal_buyer,
      disposal_notes,
    } = body as {
      disposal_date?: string
      disposal_type?: DisposalType
      proceeds?: number
      disposal_amount?: number
      payment_account_id?: string | null
      reason?: string | null
      idempotency_key?: string | null
      disposal_buyer?: string | null
      disposal_notes?: string | null
    }

    const type = (disposal_type || "cash") as DisposalType
    const normalizedProceeds = normalizeDisposalProceeds(type, proceeds ?? disposal_amount)

    const validationError = validateDisposalInput({
      disposal_date: disposal_date ?? "",
      disposal_type: type,
      proceeds: normalizedProceeds,
      payment_account_id,
    })
    if (validationError) {
      return NextResponse.json({ error: validationError, code: "VALIDATION_ERROR" }, { status: 400 })
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

    const { data: rpcResult, error: rpcError } = await supabase.rpc("post_asset_disposal", {
      p_asset_id: assetId,
      p_disposal_date: disposal_date,
      p_proceeds: normalizedProceeds,
      p_disposal_type: type,
      p_payment_account_id: payment_account_id ?? null,
      p_reason: reason ?? null,
      p_idempotency_key: idempotency_key ?? null,
      p_disposed_by: userId,
      p_buyer: disposal_buyer ?? null,
      p_notes: disposal_notes ?? null,
    })

    if (rpcError) {
      const mapped = mapDisposalRpcError(rpcError.message)
      return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status })
    }

    if (!rpcResult || typeof rpcResult !== "object") {
      return NextResponse.json({ error: "Disposal failed", code: "DISPOSAL_FAILED" }, { status: 500 })
    }

    const result = rpcResult as DisposalPostResult
    if (!result.journal_entry_id) {
      return NextResponse.json({ error: "Disposal returned incomplete result", code: "DISPOSAL_FAILED" }, { status: 500 })
    }

    await createAuditLog({
      businessId: business.id,
      userId,
      actionType: "asset.disposed",
      entityType: "asset",
      entityId: assetId,
      newValues: result,
      request,
    })

    revalidatePath("/assets")
    revalidatePath(`/assets/${assetId}/view`)
    revalidatePath("/reports/profit-loss")
    revalidatePath("/reports/balance-sheet")

    return NextResponse.json(
      {
        asset_id: result.asset_id,
        journal_entry_id: result.journal_entry_id,
        disposal_date: result.disposal_date,
        proceeds: result.proceeds,
        disposal_type: result.disposal_type,
        carrying_value: result.carrying_value,
        gain_loss: result.gain_loss,
        idempotent: result.idempotent ?? false,
      },
      { status: result.idempotent ? 200 : 201 }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("Error disposing asset:", err)
    return NextResponse.json({ error: message, code: "INTERNAL_ERROR" }, { status: 500 })
  }
}
