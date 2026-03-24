import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

export async function GET(
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

    // Get asset — scoped to the authenticated business
    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (assetError || !asset) {
      return NextResponse.json(
        { error: "Asset not found" },
        { status: 404 }
      )
    }

    // Get depreciation entries
    const { data: depreciationEntries, error: depError } = await supabase
      .from("depreciation_entries")
      .select("*")
      .eq("asset_id", assetId)
      .is("deleted_at", null)
      .order("date", { ascending: false })

    if (depError) {
      console.error("Error fetching depreciation entries:", depError)
    }

    return NextResponse.json({
      asset,
      depreciationEntries: depreciationEntries || [],
    })
  } catch (error: any) {
    console.error("Error fetching asset:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(
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

    // Verify asset exists and belongs to this business
    const { data: existingAsset } = await supabase
      .from("assets")
      .select("id, status, purchase_amount, salvage_value")
      .eq("id", assetId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (!existingAsset) {
      return NextResponse.json(
        { error: "Asset not found" },
        { status: 404 }
      )
    }

    // Don't allow editing disposed assets
    if (existingAsset.status === "disposed") {
      return NextResponse.json(
        { error: "Cannot edit disposed assets" },
        { status: 400 }
      )
    }

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
      notes,
      attachment_path,
    } = body

    // Recalculate current value if purchase amount or salvage value changed
    let updateData: any = {}
    if (name) updateData.name = name.trim()
    if (asset_code) updateData.asset_code = asset_code.trim()
    if (category) updateData.category = category
    if (purchase_date) updateData.purchase_date = purchase_date
    if (purchase_amount !== undefined) updateData.purchase_amount = Number(purchase_amount)
    if (supplier_name !== undefined) updateData.supplier_name = supplier_name?.trim() || null
    if (useful_life_years) updateData.useful_life_years = Number(useful_life_years)
    if (salvage_value !== undefined) updateData.salvage_value = Number(salvage_value)
    if (notes !== undefined) updateData.notes = notes?.trim() || null
    if (attachment_path !== undefined) updateData.attachment_path = attachment_path || null

    // Recalculate current value
    if (updateData.purchase_amount !== undefined || updateData.salvage_value !== undefined) {
      const newPurchaseAmount = updateData.purchase_amount ?? existingAsset.purchase_amount
      const newSalvageValue = updateData.salvage_value ?? existingAsset.salvage_value
      const { data: assetData } = await supabase
        .from("assets")
        .select("accumulated_depreciation")
        .eq("id", assetId)
        .single()

      const accumulatedDep = Number(assetData?.accumulated_depreciation || 0)
      updateData.current_value = newPurchaseAmount - accumulatedDep
    }

    const { data: asset, error: updateError } = await supabase
      .from("assets")
      .update(updateData)
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

    // Log audit entry
    try {
      if (business && asset) {
        await createAuditLog({
          businessId: business.id,
          userId: user?.id || null,
          actionType: "asset.updated",
          entityType: "asset",
          entityId: assetId,
          oldValues: existingAsset,
          newValues: asset,
          request,
        })
      }
    } catch (auditError) {
      console.error("Error logging audit:", auditError)
    }

    return NextResponse.json({ asset })
  } catch (error: any) {
    console.error("Error updating asset:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(
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

    // Soft delete — scoped to authenticated business
    const { error: deleteError } = await supabase
      .from("assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", assetId)
      .eq("business_id", business.id)

    if (deleteError) {
      console.error("Error deleting asset:", deleteError)
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 }
      )
    }

    // Log audit entry
    try {
      if (business) {
        const { data: deletedAsset } = await supabase
          .from("assets")
          .select("*")
          .eq("id", assetId)
          .single()

        await createAuditLog({
          businessId: business.id,
          userId: user?.id || null,
          actionType: "asset.deleted",
          entityType: "asset",
          entityId: assetId,
          oldValues: deletedAsset || null,
          newValues: null,
          request,
          description: `Asset ${assetId} deleted`,
        })
      }
    } catch (auditError) {
      console.error("Error logging audit:", auditError)
    }

    return NextResponse.json({ message: "Asset deleted successfully" })
  } catch (error: any) {
    console.error("Error deleting asset:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


