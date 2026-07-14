import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { enforceServiceIndustryMinTierWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { mapBackfillRpcError } from "@/lib/assets/batchDepreciationApiErrors"

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
    const {
      name,
      asset_code,
      category,
      purchase_date,
      purchase_amount,
      supplier_name,
      useful_life_years,
      salvage_value,
      payment_account_id,
      notes,
      attachment_path,
      backfill_historical_depreciation = true,
    } = body

    if (!name || !category || !purchase_date || !purchase_amount || !useful_life_years) {
      return NextResponse.json(
        { error: "Missing required fields", code: "VALIDATION_ERROR" },
        { status: 400 }
      )
    }

    let finalAssetCode = asset_code
    if (!finalAssetCode) {
      const { data: codeData } = await supabase.rpc("generate_asset_code", {
        p_business_id: business.id,
      })
      finalAssetCode = codeData || `AST-${Date.now()}`
    }

    const purchaseAmount = Number(purchase_amount)
    const salvageValue = Number(salvage_value || 0)

    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .insert({
        business_id: business.id,
        name: name.trim(),
        asset_code: finalAssetCode,
        category,
        purchase_date,
        purchase_amount: purchaseAmount,
        supplier_name: supplier_name?.trim() || null,
        useful_life_years: Number(useful_life_years),
        salvage_value: salvageValue,
        current_value: purchaseAmount,
        accumulated_depreciation: 0,
        notes: notes?.trim() || null,
        attachment_path: attachment_path || null,
      })
      .select()
      .single()

    if (assetError) {
      return NextResponse.json({ error: assetError.message, code: "CREATE_FAILED" }, { status: 500 })
    }

    const { data: journalEntryId, error: ledgerError } = await supabase.rpc(
      "post_asset_purchase_to_ledger",
      {
        p_asset_id: asset.id,
        p_payment_account_id: payment_account_id || null,
      }
    )

    if (ledgerError || !journalEntryId) {
      await supabase.from("assets").delete().eq("id", asset.id)
      return NextResponse.json(
        {
          error:
            ledgerError?.message ||
            "Failed to post asset acquisition to ledger. Check that the accounting period for the purchase date is open.",
          code: "ACQUISITION_POST_FAILED",
        },
        { status: 500 }
      )
    }

    let backfillResult = null
    if (backfill_historical_depreciation) {
      const purchaseMonth = new Date(purchase_date)
      const today = new Date()
      const isHistorical =
        purchaseMonth.getFullYear() < today.getFullYear() ||
        (purchaseMonth.getFullYear() === today.getFullYear() && purchaseMonth.getMonth() < today.getMonth())

      if (isHistorical) {
        const { data: backfill, error: backfillError } = await supabase.rpc(
          "backfill_asset_historical_depreciation",
          {
            p_asset_id: asset.id,
            p_through_date: null,
            p_posted_by: user.id,
          }
        )

        if (backfillError) {
          const mapped = mapBackfillRpcError(backfillError.message)
          const { data: currentAsset } = await supabase.from("assets").select("*").eq("id", asset.id).single()
          return NextResponse.json(
            {
              success: false,
              partial: true,
              asset: currentAsset,
              assetId: asset.id,
              acquisition_journal_entry_id: journalEntryId,
              backfill_error: mapped.error,
              code: mapped.code,
              message:
                "Asset and acquisition journal created, but historical depreciation backfill did not complete. Retry backfill or post depreciation manually.",
            },
            { status: 207 }
          )
        }

        backfillResult = backfill

        if (backfill && backfill.failed_count > 0) {
          const { data: currentAsset } = await supabase.from("assets").select("*").eq("id", asset.id).single()
          return NextResponse.json(
            {
              success: false,
              partial: true,
              asset: currentAsset,
              assetId: asset.id,
              acquisition_journal_entry_id: journalEntryId,
              backfill: backfillResult,
              code: "BACKFILL_PARTIAL",
              message:
                "Asset and acquisition journal created, but historical backfill stopped with failures. See backfill details.",
            },
            { status: 207 }
          )
        }
      }
    }

    await createAuditLog({
      businessId: business.id,
      userId: user.id,
      actionType: "asset.created",
      entityType: "asset",
      entityId: asset.id,
      oldValues: null,
      newValues: asset,
      request,
    })

    const { data: updatedAsset } = await supabase.from("assets").select("*").eq("id", asset.id).single()

    return NextResponse.json(
      {
        success: true,
        asset: updatedAsset || asset,
        assetId: asset.id,
        acquisition_journal_entry_id: journalEntryId,
        backfill: backfillResult,
      },
      { status: 201 }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error"
    console.error("Error creating asset:", error)
    return NextResponse.json({ error: message, code: "INTERNAL_ERROR" }, { status: 500 })
  }
}
