import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { buildCustomerStatementData } from "@/lib/statements/buildCustomerStatementData"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")

    const statement = await buildCustomerStatementData({
      supabase,
      businessId: business.id,
      customerId: id,
      filters: { startDate, endDate },
    })

    return NextResponse.json({
      customer: statement.customer,
      invoices: statement.invoices,
      payments: statement.payments,
      creditNotes: statement.creditNotes,
      summary: statement.summary,
      transactions: statement.transactions,
    })
  } catch (error: any) {
    if (error?.status === 404) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 })
    }
    console.error("Error generating statement:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

