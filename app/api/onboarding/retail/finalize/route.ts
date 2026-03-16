import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

/**
 * TRACK C1.5 - Retail Onboarding Finalization Gate
 * 
 * POST /api/onboarding/retail/finalize
 * 
 * Server-side validation to ensure a Retail business can only complete
 * onboarding if it is truly Retail-ready (stores, registers, products,
 * COA initialized, accounting period exists).
 * 
 * VALIDATION CHECKLIST (in order):
 * 1. Business ownership - Business exists and belongs to authenticated user
 * 2. Store existence - At least one store exists for the business
 * 3. Register existence - At least one register exists for the business
 * 4. Product existence - At least one product exists for the business
 * 5. System accounts initialization - Ensure system accounts exist via create_system_accounts (if count == 0)
 * 6. Chart of Accounts initialization - Call initialize_business_chart_of_accounts
 * 7. Accounting period initialization - Call initialize_business_accounting_period (ensures at least one period exists)
 * 
 * If all checks pass → Update onboarding_step = 'complete'
 * If any check fails → Return 400 with clear error message
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // ============================================================================
    // VALIDATION 1: Business Ownership
    // ============================================================================
    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    // Verify business belongs to user (owner check)
    if (business.owner_id !== user.id) {
      return NextResponse.json({ error: "Forbidden: Business does not belong to user" }, { status: 403 })
    }

    // Verify business is Retail
    if (business.industry !== "retail") {
      return NextResponse.json(
        { error: "Invalid business type: This endpoint is for Retail businesses only" },
        { status: 400 }
      )
    }

    const businessId = business.id

    // Idempotency: If already complete, return success
    if (business.onboarding_step === "complete") {
      return NextResponse.json({ status: "ok", onboarding: "complete" })
    }

    // ============================================================================
    // VALIDATION 2: Store Existence
    // ============================================================================
    const { data: stores, error: storesError } = await supabase
      .from("stores")
      .select("id")
      .eq("business_id", businessId)
      .limit(1)

    if (storesError) {
      console.error("Error checking stores:", storesError)
      return NextResponse.json(
        { error: "Failed to validate stores" },
        { status: 500 }
      )
    }

    if (!stores || stores.length === 0) {
      return NextResponse.json(
        { error: "Retail onboarding incomplete: store not created" },
        { status: 400 }
      )
    }

    // ============================================================================
    // VALIDATION 3: Register Existence
    // ============================================================================
    // Check if at least one register exists for the business
    // Registers can be associated with a store_id or directly with business_id
    const { data: registers, error: registersError } = await supabase
      .from("registers")
      .select("id")
      .eq("business_id", businessId)
      .limit(1)

    if (registersError) {
      console.error("Error checking registers:", registersError)
      return NextResponse.json(
        { error: "Failed to validate registers" },
        { status: 500 }
      )
    }

    if (!registers || registers.length === 0) {
      return NextResponse.json(
        { error: "Retail onboarding incomplete: register not created" },
        { status: 400 }
      )
    }

    // ============================================================================
    // VALIDATION 4: Product Existence
    // ============================================================================
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id")
      .eq("business_id", businessId)
      .limit(1)

    if (productsError) {
      console.error("Error checking products:", productsError)
      return NextResponse.json(
        { error: "Failed to validate products" },
        { status: 500 }
      )
    }

    if (!products || products.length === 0) {
      return NextResponse.json(
        { error: "Retail onboarding incomplete: no products created" },
        { status: 400 }
      )
    }

    // ============================================================================
    // VALIDATION 5: System Accounts Initialization
    // ============================================================================
    // Ensure system accounts exist before COA bootstrap
    // Check if accounts exist for this business - if count == 0, seed them
    const { count: accountsCount, error: accountsCountError } = await supabase
      .from("accounts")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)

    if (accountsCountError) {
      console.error("Error checking accounts:", accountsCountError)
      return NextResponse.json(
        { error: "Failed to validate accounts" },
        { status: 500 }
      )
    }

    // If no accounts exist, create system accounts
    if (accountsCount === 0) {
      const { error: systemAccountsError } = await supabase.rpc("create_system_accounts", {
        p_business_id: businessId,
      })

      if (systemAccountsError) {
        console.error("Error initializing system accounts:", systemAccountsError)
        // Propagate error - do NOT swallow or retry silently
        return NextResponse.json(
          { error: "System accounts initialization failed" },
          { status: 500 }
        )
      }
    }

    // ============================================================================
    // VALIDATION 6: Chart of Accounts Initialization
    // ============================================================================
    // Call initialize_business_chart_of_accounts via RPC
    // This function is idempotent - safe to call multiple times
    const { error: coaError } = await supabase.rpc("initialize_business_chart_of_accounts", {
      p_business_id: businessId,
    })

    if (coaError) {
      console.error("Error initializing chart of accounts:", coaError)
      // Propagate error - do NOT swallow or retry silently
      return NextResponse.json(
        { error: `Failed to initialize chart of accounts: ${coaError.message || "Unknown error"}` },
        { status: 500 }
      )
    }

    // ============================================================================
    // VALIDATION 7: Accounting bootstrap (Phase 13: CoA + one open period)
    // ============================================================================
    // ensure_accounting_initialized is idempotent; creates CoA + period if none.
    const { error: bootstrapError } = await supabase.rpc("ensure_accounting_initialized", {
      p_business_id: businessId,
    })

    if (bootstrapError) {
      console.error("Error ensuring accounting initialized:", bootstrapError)
      return NextResponse.json(
        { error: "Unable to start accounting. Please try again." },
        { status: 500 }
      )
    }

    // ============================================================================
    // ALL VALIDATIONS PASSED - Finalize Onboarding
    // ============================================================================
    const { error: updateError } = await supabase
      .from("businesses")
      .update({ onboarding_step: "complete" })
      .eq("id", businessId)

    if (updateError) {
      console.error("Error updating onboarding step:", updateError)
      return NextResponse.json(
        { error: "Failed to complete onboarding" },
        { status: 500 }
      )
    }

    return NextResponse.json({ status: "ok", onboarding: "complete" })
  } catch (error: any) {
    console.error("Error in retail onboarding finalization:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
