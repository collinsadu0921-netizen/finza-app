import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

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

    const tierDenied = await enforceServiceIndustryMinTier(
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
    } = body

    if (!name || !category || !purchase_date || !purchase_amount || !useful_life_years) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // Generate asset code if not provided
    let finalAssetCode = asset_code
    if (!finalAssetCode) {
      const { data: codeData } = await supabase.rpc("generate_asset_code", {
        p_business_id: business.id,
      })
      finalAssetCode = codeData || `AST-${Date.now()}`
    }

    // Calculate initial values
    const purchaseAmount = Number(purchase_amount)
    const salvageValue = Number(salvage_value || 0)
    // Current value starts at purchase amount, decreases as depreciation accumulates
    const currentValue = purchaseAmount

    // Create asset
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
        current_value: currentValue,
        accumulated_depreciation: 0,
        notes: notes?.trim() || null,
        attachment_path: attachment_path || null,
      })
      .select()
      .single()

    if (assetError) {
      console.error("Error creating asset:", assetError)
      return NextResponse.json(
        { error: assetError.message },
        { status: 500 }
      )
    }

    // Post to ledger (canonical: asset must have ledger journal; period enforced in RPC)
    const { data: journalEntryId, error: ledgerError } = await supabase.rpc(
      "post_asset_purchase_to_ledger",
      {
        p_asset_id: asset.id,
        p_payment_account_id: payment_account_id || null,
      }
    )

    if (ledgerError || !journalEntryId) {
      console.error("Error posting asset to ledger:", ledgerError)
      await supabase.from("assets").delete().eq("id", asset.id)
      return NextResponse.json(
        {
          error: ledgerError?.message || "Failed to post asset acquisition to ledger. Check that the accounting period for the purchase date is open.",
        },
        { status: 500 }
      )
    }

    // Automatically create depreciation entries from purchase date to current month
    try {
      const purchaseDate = new Date(purchase_date)
      const today = new Date()
      const currentYear = today.getFullYear()
      const currentMonth = today.getMonth() // 0-indexed
      
      // Get monthly depreciation amount
      const { data: monthlyDep } = await supabase.rpc(
        "calculate_monthly_depreciation",
        {
          p_purchase_amount: purchaseAmount,
          p_salvage_value: salvageValue,
          p_useful_life_years: Number(useful_life_years),
        }
      )

      const monthlyDepreciation = Number(monthlyDep || 0)

      if (monthlyDepreciation > 0) {
        const maxDepreciation = purchaseAmount - salvageValue
        let totalAccumulatedDep = 0
        const depreciationEntries = []
        
        // Start from the purchase month
        let year = purchaseDate.getFullYear()
        let month = purchaseDate.getMonth()
        
        // Create entries for each month up to (but not including) the current month
        while (
          year < currentYear || 
          (year === currentYear && month < currentMonth)
        ) {
          // Check if we've exceeded max depreciation
          const wouldExceed = totalAccumulatedDep + monthlyDepreciation > maxDepreciation
          if (wouldExceed) {
            break // Stop if asset would be fully depreciated
          }

          // Create depreciation date (first day of the month)
          const depDate = new Date(year, month, 1)
          const depDateStr = `${year}-${String(month + 1).padStart(2, '0')}-01`

          // Check if entry already exists (shouldn't, but safety check)
          const { data: existingEntry } = await supabase
            .from("depreciation_entries")
            .select("id")
            .eq("asset_id", asset.id)
            .eq("date", depDateStr)
            .is("deleted_at", null)
            .single()

          if (!existingEntry) {
            depreciationEntries.push({
              asset_id: asset.id,
              business_id: business.id,
              date: depDateStr,
              amount: monthlyDepreciation,
            })
            totalAccumulatedDep += monthlyDepreciation
          }

          // Move to next month
          month++
          if (month > 11) {
            month = 0
            year++
          }
        }

        // Batch insert depreciation entries
        if (depreciationEntries.length > 0) {
          const { error: depError } = await supabase
            .from("depreciation_entries")
            .insert(depreciationEntries)

          if (depError) {
            console.error("Error creating depreciation entries:", depError)
          } else {
            // Update asset with accumulated depreciation
            const finalCurrentValue = purchaseAmount - totalAccumulatedDep
            await supabase
              .from("assets")
              .update({
                accumulated_depreciation: totalAccumulatedDep,
                current_value: finalCurrentValue,
              })
              .eq("id", asset.id)

            // Post each depreciation entry to ledger (period enforced in RPC; duplicate guarded)
            for (const entry of depreciationEntries) {
              const { data: insertedEntry } = await supabase
                .from("depreciation_entries")
                .select("id")
                .eq("asset_id", entry.asset_id)
                .eq("date", entry.date)
                .eq("business_id", entry.business_id)
                .single()

              if (insertedEntry) {
                const { error: depLedgerError } = await supabase.rpc("post_depreciation_to_ledger", {
                  p_depreciation_entry_id: insertedEntry.id,
                })
                if (depLedgerError) {
                  console.error(`Error posting depreciation to ledger for ${entry.date}:`, depLedgerError)
                  // Do not fail entire asset creation; backfilled depreciation can be retried or fixed in period
                }
              }
            }

            console.log(`Created ${depreciationEntries.length} depreciation entries automatically`)
          }
        }
      }
    } catch (depError: any) {
      console.error("Error auto-creating depreciation entries:", depError)
      // Don't fail asset creation if depreciation creation fails
    }

    // Log audit entry
    await createAuditLog({
      businessId: business.id,
      userId: user?.id || null,
      actionType: "asset.created",
      entityType: "asset",
      entityId: asset.id,
      oldValues: null,
      newValues: asset,
      request,
    })

    // Reload asset to get updated depreciation values
    const { data: updatedAsset } = await supabase
      .from("assets")
      .select("*")
      .eq("id", asset.id)
      .single()

    return NextResponse.json({ 
      success: true,
      asset: updatedAsset || asset,
      assetId: asset.id 
    }, { status: 201 })
  } catch (error: any) {
    console.error("Error creating asset:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


