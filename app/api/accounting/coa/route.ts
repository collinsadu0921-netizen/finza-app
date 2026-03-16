import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"

/**
 * GET /api/accounting/coa?business_id=...
 * 
 * Returns read-only Chart of Accounts for accounting mode.
 * Access: Admin or Accountant (read or write) only
 * 
 * Returns:
 * - id
 * - code
 * - name
 * - type (asset/liability/equity/income/expense)
 * - description
 * - is_system
 * 
 * Sorted by code ASC
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")

    if (!businessId) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }

    const authResult = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!authResult.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants can access Chart of Accounts." },
        { status: 403 }
      )
    }

    // Get all accounts for business (read-only, no mutations)
    const { data: accounts, error } = await supabase
      .from("accounts")
      .select("id, code, name, type, description, is_system, sub_type")
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .order("code", { ascending: true })

    if (error) {
      console.error("Error fetching Chart of Accounts:", error)
      return NextResponse.json(
        { error: error.message || "Failed to fetch Chart of Accounts" },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      accounts: accounts || [],
      // Include metadata for client-side filtering
      metadata: {
        total: accounts?.length || 0,
        allowedTypes: ["asset", "liability", "equity"],
        forbiddenTypes: ["income", "expense"],
      }
    })
  } catch (error: any) {
    console.error("Error in COA API:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
