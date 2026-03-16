import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle Next.js 16 params (can be a Promise)
    const resolvedParams = await Promise.resolve(params)
    const assetId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    // AUTH DISABLED FOR DEVELOPMENT - Get business or use first business
    let business
    if (user) {
      business = await getCurrentBusiness(supabase, user.id)
    }
    
    if (!business) {
      const { data: firstBusiness } = await supabase
        .from("businesses")
        .select("id")
        .limit(1)
        .single()
      if (firstBusiness) {
        business = firstBusiness
      }
    }

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const body = await request.json()
    const { date, month, year } = body

    // Get asset
    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .select("*")
      .eq("id", assetId)
      // AUTH DISABLED FOR DEVELOPMENT
      // .eq("business_id", business.id)
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
        { error: "Cannot depreciate disposed assets" },
        { status: 400 }
      )
    }

    // Determine depreciation date
    let depreciationDate: string
    if (date) {
      depreciationDate = date
    } else if (month && year) {
      depreciationDate = `${year}-${String(month).padStart(2, "0")}-01`
    } else {
      // Default to first day of current month
      const now = new Date()
      depreciationDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
    }

    // Check if depreciation already exists for this month/year
    // Extract year-month from depreciationDate (format: YYYY-MM-DD)
    const yearMonth = depreciationDate.substring(0, 7) // Gets "YYYY-MM"
    
    const { data: existingDepEntries } = await supabase
      .from("depreciation_entries")
      .select("id, date")
      .eq("asset_id", assetId)
      .is("deleted_at", null)

    // Check if any existing entry is in the same month/year
    const existingInMonth = existingDepEntries?.some((entry: any) => {
      const entryYearMonth = entry.date.substring(0, 7)
      return entryYearMonth === yearMonth
    })

    if (existingInMonth) {
      const existingEntry = existingDepEntries?.find((entry: any) => {
        const entryYearMonth = entry.date.substring(0, 7)
        return entryYearMonth === yearMonth
      })
      // Format the date nicely for display
      const formattedDate = existingEntry?.date 
        ? new Date(existingEntry.date).toLocaleDateString("en-GH", { year: "numeric", month: "long", day: "numeric" })
        : "N/A"
      
      return NextResponse.json(
        { 
          error: `Depreciation already recorded for ${yearMonth}. Existing entry date: ${formattedDate}. Please select a different month or wait until next month.`,
          existingDate: existingEntry?.date,
          yearMonth: yearMonth
        },
        { status: 400 }
      )
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
      return NextResponse.json(
        { error: "Depreciation amount is zero or negative" },
        { status: 400 }
      )
    }

    // Check if asset is fully depreciated
    const newAccumulatedDep = Number(asset.accumulated_depreciation || 0) + depreciationAmount
    const maxDepreciation = Number(asset.purchase_amount) - Number(asset.salvage_value)

    if (newAccumulatedDep > maxDepreciation) {
      return NextResponse.json(
        { error: "Asset is fully depreciated" },
        { status: 400 }
      )
    }

    // Create depreciation entry
    const { data: depEntry, error: depError } = await supabase
      .from("depreciation_entries")
      .insert({
        asset_id: assetId,
        business_id: business.id,
        date: depreciationDate,
        amount: depreciationAmount,
      })
      .select()
      .single()

    if (depError) {
      console.error("Error creating depreciation entry:", depError)
      return NextResponse.json(
        { error: depError.message },
        { status: 500 }
      )
    }

    // Post to ledger (period enforced in RPC; duplicate posting guarded)
    const { data: journalEntryId, error: ledgerError } = await supabase.rpc(
      "post_depreciation_to_ledger",
      { p_depreciation_entry_id: depEntry.id }
    )

    if (ledgerError) {
      console.error("Error posting depreciation to ledger:", ledgerError)
      await supabase.from("depreciation_entries").delete().eq("id", depEntry.id)
      return NextResponse.json(
        {
          error: ledgerError.message || "Failed to post depreciation to ledger. Ensure the accounting period for this date is open and the entry is not already posted.",
        },
        { status: 500 }
      )
    }

    // Update asset
    const newCurrentValue = Number(asset.purchase_amount) - newAccumulatedDep
    const { error: updateError } = await supabase
      .from("assets")
      .update({
        accumulated_depreciation: newAccumulatedDep,
        current_value: newCurrentValue,
      })
      .eq("id", assetId)

    if (updateError) {
      console.error("Error updating asset:", updateError)
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        message: "Depreciation recorded successfully",
        depreciationEntry: depEntry,
        updatedAsset: {
          accumulated_depreciation: newAccumulatedDep,
          current_value: newCurrentValue,
        },
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error("Error recording depreciation:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle Next.js 16 params (can be a Promise)
    const resolvedParams = await Promise.resolve(params)
    const assetId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    // AUTH DISABLED FOR DEVELOPMENT - Get business or use first business
    let business
    if (user) {
      business = await getCurrentBusiness(supabase, user.id)
    }
    
    if (!business) {
      const { data: firstBusiness } = await supabase
        .from("businesses")
        .select("id")
        .limit(1)
        .single()
      if (firstBusiness) {
        business = firstBusiness
      }
    }

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    // Get all depreciation entries for this asset
    const { data: entries, error } = await supabase
      .from("depreciation_entries")
      .select("*")
      .eq("asset_id", assetId)
      // AUTH DISABLED FOR DEVELOPMENT
      // .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("date", { ascending: false })

    if (error) {
      console.error("Error fetching depreciation entries:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ entries: entries || [] })
  } catch (error: any) {
    console.error("Error fetching depreciation entries:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


