import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const { accountId } = await params
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

    const tierBlockPerGet = await enforceServiceIndustryBusinessTierForAccountingApi(
      supabase,
      user.id,
      business.id
    )
    if (tierBlockPerGet) return tierBlockPerGet

    // Verify account belongs to business
    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .eq("business_id", business.id)
      .single()

    if (!account) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      )
    }

    const { data: periods, error } = await supabase
      .from("reconciliation_periods")
      .select("*")
      .eq("business_id", business.id)
      .eq("account_id", accountId)
      .is("deleted_at", null)
      .order("period_start", { ascending: false })

    if (error) {
      console.error("Error fetching periods:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ periods: periods || [] })
  } catch (error: any) {
    console.error("Error in reconciliation periods:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const { accountId } = await params
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

    const tierBlockPerPost = await enforceServiceIndustryBusinessTierForAccountingApi(
      supabase,
      user.id,
      business.id
    )
    if (tierBlockPerPost) return tierBlockPerPost

    const body = await request.json()
    const { period_start, period_end, bank_ending_balance, notes } = body

    if (!period_start || !period_end) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // Verify account belongs to business
    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .eq("business_id", business.id)
      .single()

    if (!account) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      )
    }

    // Calculate opening balance
    const { data: openingBalance } = await supabase.rpc(
      "calculate_account_balance_as_of",
      {
        p_business_id: business.id,
        p_account_id: accountId,
        p_as_of_date: period_start,
      }
    )

    // Calculate system ending balance
    const { data: systemEndingBalance } = await supabase.rpc(
      "calculate_account_balance_as_of",
      {
        p_business_id: business.id,
        p_account_id: accountId,
        p_as_of_date: period_end,
      }
    )

    const difference = (bank_ending_balance || 0) - (systemEndingBalance || 0)

    const { data: period, error } = await supabase
      .from("reconciliation_periods")
      .insert({
        business_id: business.id,
        account_id: accountId,
        period_start,
        period_end,
        opening_balance: openingBalance || 0,
        bank_ending_balance: bank_ending_balance || null,
        system_ending_balance: systemEndingBalance || 0,
        difference,
        reconciled_by: difference === 0 ? user.id : null,
        reconciled_at: difference === 0 ? new Date().toISOString() : null,
        notes: notes?.trim() || null,
      })
      .select()
      .single()

    if (error) {
      console.error("Error creating period:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ period }, { status: 201 })
  } catch (error: any) {
    console.error("Error creating reconciliation period:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


