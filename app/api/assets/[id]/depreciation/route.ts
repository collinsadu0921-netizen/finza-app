/**
 * POST /api/assets/[id]/depreciation  — record a depreciation entry for an asset
 * GET  /api/assets/[id]/depreciation  — list depreciation entries for an asset
 * DELETE /api/assets/[id]/depreciation — delete a depreciation entry
 *
 * Requires: authenticated user, business membership, Professional tier for Service businesses
 */
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

async function resolveAndEnforce(supabase: any, user: any) {
  if (!user) return { denied: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const business = await getCurrentBusiness(supabase, user.id)
  if (!business) return { denied: NextResponse.json({ error: "Business not found" }, { status: 404 }) }
  const denied = await enforceServiceIndustryMinTier(
    supabase,
    user.id,
    business.id,
    "professional"
  )
  if (denied) return { denied }
  return { business }
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

    // Verify asset belongs to this business before returning its entries
    const { data: asset } = await supabase
      .from("assets").select("id").eq("id", assetId).eq("business_id", business!.id).maybeSingle()
    if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 })

    const { data: entries, error } = await supabase
      .from("depreciation_entries")
      .select("*")
      .eq("asset_id", assetId)
      .is("deleted_at", null)
      .order("date", { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ entries: entries || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 })
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

    const { denied, business } = await resolveAndEnforce(supabase, user)
    if (denied) return denied

    const body = await request.json()
    const { date, month, year } = body

    // Get asset — scoped to authenticated business
    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .eq("business_id", business!.id)
      .is("deleted_at", null)
      .single()

    if (assetError || !asset) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 })
    }

    if (asset.status === "disposed") {
      return NextResponse.json({ error: "Cannot depreciate a disposed asset" }, { status: 400 })
    }

    // Calculate depreciation amount (straight-line)
    const monthlyDepreciation =
      asset.depreciation_method === "straight_line"
        ? (Number(asset.purchase_amount) - Number(asset.salvage_value)) /
          (Number(asset.useful_life_years) * 12)
        : 0

    const bookValue = Number(asset.current_book_value ?? asset.purchase_amount)
    const depAmount = Math.min(monthlyDepreciation, Math.max(0, bookValue - Number(asset.salvage_value)))

    if (depAmount <= 0) {
      return NextResponse.json({ error: "Asset is fully depreciated" }, { status: 400 })
    }

    const newBookValue = bookValue - depAmount

    const { data: entry, error: entryError } = await supabase
      .from("depreciation_entries")
      .insert({
        asset_id:             assetId,
        business_id:          business!.id,
        date:                 date || new Date().toISOString().split("T")[0],
        month:                month ?? new Date().getMonth() + 1,
        year:                 year  ?? new Date().getFullYear(),
        depreciation_amount:  depAmount,
        book_value_after:     newBookValue,
      })
      .select()
      .single()

    if (entryError) {
      console.error("Error creating depreciation entry:", entryError)
      return NextResponse.json({ error: entryError.message }, { status: 500 })
    }

    // Update asset current_book_value
    await supabase
      .from("assets")
      .update({ current_book_value: newBookValue, updated_at: new Date().toISOString() })
      .eq("id", assetId)
      .eq("business_id", business!.id)

    return NextResponse.json({ entry }, { status: 201 })
  } catch (err: any) {
    console.error("Error recording depreciation:", err)
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 })
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

    const { denied, business } = await resolveAndEnforce(supabase, user)
    if (denied) return denied

    // Only allow deleting entries that belong to this business's asset
    const { data: asset } = await supabase
      .from("assets").select("id").eq("id", assetId).eq("business_id", business!.id).maybeSingle()
    if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 })

    const { searchParams } = new URL(request.url)
    const entryId = searchParams.get("entry_id")
    if (!entryId) return NextResponse.json({ error: "entry_id is required" }, { status: 400 })

    const { error } = await supabase
      .from("depreciation_entries")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", entryId)
      .eq("asset_id", assetId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 })
  }
}
