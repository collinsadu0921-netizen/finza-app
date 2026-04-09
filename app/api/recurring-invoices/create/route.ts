import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { assertBusinessNotArchived } from "@/lib/archivedBusiness"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const {
      business_id,
      customer_id,
      frequency,
      next_run_date,
      auto_send,
      auto_whatsapp,
      invoice_template_data,
      status = "active",
    } = body

    // Validate required fields
    if (!business_id || !frequency || !next_run_date || !invoice_template_data) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    const scope = await resolveBusinessScopeForUser(supabase, user.id, business_id)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    try {
      await assertBusinessNotArchived(supabase, scope.businessId)
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "Business is archived" },
        { status: 403 }
      )
    }

    // Canonical tax guard: when apply_taxes is true, template must include tax metadata (same as invoices)
    const applyTaxes = invoice_template_data?.apply_taxes === true
    if (applyTaxes) {
      const hasTaxLines =
        invoice_template_data.tax_lines &&
        Array.isArray(invoice_template_data.tax_lines?.lines) &&
        invoice_template_data.tax_lines.lines.length >= 0
      if (!hasTaxLines) {
        return NextResponse.json(
          { error: "When apply_taxes is true, invoice_template_data must include tax_lines with lines array" },
          { status: 400 }
        )
      }
    }

    // Validate frequency
    const validFrequencies = ["weekly", "biweekly", "monthly", "quarterly", "yearly"]
    if (!validFrequencies.includes(frequency)) {
      return NextResponse.json(
        { error: "Invalid frequency" },
        { status: 400 }
      )
    }

    // Create recurring invoice
    const { data: recurringInvoice, error: createError } = await supabase
      .from("recurring_invoices")
      .insert({
        business_id: scope.businessId,
        customer_id: customer_id || null,
        frequency,
        next_run_date,
        auto_send: auto_send || false,
        auto_whatsapp: auto_whatsapp || false,
        invoice_template_data,
        status: status || "active",
      })
      .select()
      .single()

    if (createError) {
      console.error("Error creating recurring invoice:", createError)
      return NextResponse.json(
        { error: createError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ recurringInvoice }, { status: 201 })
  } catch (error: any) {
    console.error("Error creating recurring invoice:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
