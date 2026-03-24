import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle Next.js 16 params (can be a Promise)
    const resolvedParams = await Promise.resolve(params)
    const assetId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const denied = await enforceServiceWorkspaceAccess({
      supabase, userId: user.id, businessId: business.id, minTier: "business",
    })
    if (denied) return denied

    const body = await request.json()
    const { disposal_date, disposal_amount, disposal_buyer, disposal_notes, payment_account_id } = body

    if (!disposal_date || disposal_amount === undefined) {
      return NextResponse.json(
        { error: "Missing required fields: disposal_date and disposal_amount are required" },
        { status: 400 }
      )
    }

    // Get asset — scoped to authenticated business
    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (assetError || !asset) {
      console.error("Error fetching asset:", assetError)
      return NextResponse.json(
        { error: assetError?.message || "Asset not found" },
        { status: 404 }
      )
    }

    if (asset.status === "disposed") {
      return NextResponse.json(
        { error: "Asset is already disposed" },
        { status: 400 }
      )
    }

    const disposalAmount = Number(disposal_amount)

    // Post disposal to ledger
    try {
      const { data: journalEntryId } = await supabase.rpc(
        "post_asset_disposal_to_ledger",
        {
          p_asset_id: asset.id,
          p_disposal_amount: disposalAmount,
          p_payment_account_id: payment_account_id || null,
        }
      )

      if (journalEntryId) {
        console.log("Asset disposal posted to ledger:", journalEntryId)
      }
    } catch (ledgerError: any) {
      console.error("Error posting disposal to ledger:", ledgerError)
      return NextResponse.json(
        { error: ledgerError.message || "Error posting disposal to ledger" },
        { status: 500 }
      )
    }

    // Update asset
    const { data: updatedAsset, error: updateError } = await supabase
      .from("assets")
      .update({
        status: "disposed",
        disposal_date,
        disposal_amount: disposalAmount,
        disposal_buyer: disposal_buyer?.trim() || null,
        disposal_notes: disposal_notes?.trim() || null,
        current_value: 0, // Asset is fully written off
      })
      .eq("id", assetId)
      .select()
      .single()

    if (updateError) {
      console.error("Error updating asset:", updateError)
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: "Asset disposed successfully",
      asset: updatedAsset,
    })
  } catch (error: any) {
    console.error("Error disposing asset:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


