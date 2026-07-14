import { NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { enforceServiceIndustryMinTierWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { mapBatchRpcError, type BatchDepreciationResult } from "@/lib/assets/batchDepreciationApiErrors"
import { normalizeDepreciationPostingDate } from "@/lib/assets/depreciationAmount"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found", code: "BUSINESS_NOT_FOUND" }, { status: 404 })
    }

    const tierDenied = await enforceServiceIndustryMinTierWrite(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (tierDenied) return tierDenied

    const body = await request.json()
    const { month, year, posting_date, idempotency_prefix } = body as {
      month?: number
      year?: number
      posting_date?: string
      idempotency_prefix?: string
    }

    let depreciationDate: string
    if (posting_date) {
      depreciationDate = normalizeDepreciationPostingDate(posting_date)
    } else if (month && year) {
      depreciationDate = `${year}-${String(month).padStart(2, "0")}-01`
    } else {
      const now = new Date()
      depreciationDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
    }

    const batchPrefix =
      idempotency_prefix ??
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? `batch-${crypto.randomUUID()}`
        : `batch-${Date.now()}`)

    const { data: rpcResult, error: rpcError } = await supabase.rpc("post_asset_depreciation_batch", {
      p_business_id: business.id,
      p_posting_date: depreciationDate,
      p_posted_by: user.id,
      p_idempotency_prefix: batchPrefix,
      p_max_assets: 200,
    })

    if (rpcError) {
      const mapped = mapBatchRpcError(rpcError.message)
      return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status })
    }

    if (!rpcResult || typeof rpcResult !== "object") {
      return NextResponse.json({ error: "Bulk depreciation failed", code: "BATCH_FAILED" }, { status: 500 })
    }

    const result = rpcResult as BatchDepreciationResult

    await createAuditLog({
      businessId: business.id,
      userId: user.id,
      actionType: "asset.depreciation.batch",
      entityType: "business",
      entityId: business.id,
      newValues: {
        posting_date: result.posting_date,
        posted_count: result.posted_count,
        skipped_count: result.skipped_count,
        failed_count: result.failed_count,
      },
      request,
    })

    revalidatePath("/assets")
    revalidatePath("/reports/profit-loss")
    revalidatePath("/reports/balance-sheet")

    const httpStatus = result.failed_count > 0 ? 207 : 200

    return NextResponse.json(
      {
        posting_date: result.posting_date,
        posted: result.posted ?? [],
        skipped: result.skipped ?? [],
        failed: result.failed ?? [],
        posted_count: result.posted_count ?? 0,
        skipped_count: result.skipped_count ?? 0,
        failed_count: result.failed_count ?? 0,
        partial_success: result.partial_success ?? false,
        success: result.success ?? result.failed_count === 0,
        message:
          result.failed_count > 0
            ? `Bulk depreciation completed with ${result.failed_count} failure(s).`
            : `Bulk depreciation completed: ${result.posted_count} posted, ${result.skipped_count} skipped.`,
      },
      { status: httpStatus }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error"
    console.error("Error generating depreciation:", error)
    return NextResponse.json({ error: message, code: "INTERNAL_ERROR" }, { status: 500 })
  }
}
