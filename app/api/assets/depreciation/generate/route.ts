import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const body = await request.json()
    const { month, year } = body

    // Determine depreciation date (first day of the month)
    let depreciationDate: string
    if (month && year) {
      depreciationDate = `${year}-${String(month).padStart(2, "0")}-01`
    } else {
      // Default to first day of current month
      const now = new Date()
      depreciationDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
    }

    // Get all active assets
    const { data: assets, error: assetsError } = await supabase
      .from("assets")
      .select("*")
      .eq("business_id", business.id)
      .eq("status", "active")
      .is("deleted_at", null)

    if (assetsError) {
      console.error("Error fetching assets:", assetsError)
      return NextResponse.json(
        { error: assetsError.message },
        { status: 500 }
      )
    }

    const results = []
    const errors = []

    for (const asset of assets || []) {
      // Check if depreciation already exists for this month
      const { data: existingDep } = await supabase
        .from("depreciation_entries")
        .select("id")
        .eq("asset_id", asset.id)
        .eq("date", depreciationDate)
        .is("deleted_at", null)
        .single()

      if (existingDep) {
        errors.push({
          asset_id: asset.id,
          asset_name: asset.name,
          error: "Depreciation already recorded for this month",
        })
        continue
      }

      // Calculate monthly depreciation
      const { data: monthlyDep } = await supabase.rpc(
        "calculate_monthly_depreciation",
        {
          p_purchase_amount: asset.purchase_amount,
          p_salvage_value: asset.salvage_value,
          p_useful_life_years: asset.useful_life_years,
        }
      )

      const depreciationAmount = Number(monthlyDep || 0)

      if (depreciationAmount <= 0) {
        continue // Skip assets with zero depreciation
      }

      // Check if asset is fully depreciated
      const newAccumulatedDep = Number(asset.accumulated_depreciation || 0) + depreciationAmount
      const maxDepreciation = Number(asset.purchase_amount) - Number(asset.salvage_value)

      if (newAccumulatedDep > maxDepreciation) {
        errors.push({
          asset_id: asset.id,
          asset_name: asset.name,
          error: "Asset is fully depreciated",
        })
        continue
      }

      try {
        // Create depreciation entry
        const { data: depEntry, error: depError } = await supabase
          .from("depreciation_entries")
          .insert({
            asset_id: asset.id,
            business_id: business.id,
            date: depreciationDate,
            amount: depreciationAmount,
          })
          .select()
          .single()

        if (depError) {
          errors.push({
            asset_id: asset.id,
            asset_name: asset.name,
            error: depError.message,
          })
          continue
        }

        // Post to ledger
        try {
          const { data: journalEntryId } = await supabase.rpc(
            "post_depreciation_to_ledger",
            {
              p_depreciation_entry_id: depEntry.id,
            }
          )

          if (journalEntryId) {
            console.log("Depreciation posted to ledger:", journalEntryId)
          }
        } catch (ledgerError: any) {
          console.error("Error posting depreciation to ledger:", ledgerError)
          // Continue even if ledger posting fails
        }

        // Update asset
        const newCurrentValue = Number(asset.purchase_amount) - newAccumulatedDep
        await supabase
          .from("assets")
          .update({
            accumulated_depreciation: newAccumulatedDep,
            current_value: newCurrentValue,
          })
          .eq("id", asset.id)

        results.push({
          asset_id: asset.id,
          asset_name: asset.name,
          depreciation_amount: depreciationAmount,
        })
      } catch (error: any) {
        errors.push({
          asset_id: asset.id,
          asset_name: asset.name,
          error: error.message,
        })
      }
    }

    return NextResponse.json({
      message: `Generated depreciation for ${results.length} assets`,
      results,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error: any) {
    console.error("Error generating depreciation:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


