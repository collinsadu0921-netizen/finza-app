import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const { id } = await params
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const requestedBusinessId =
      new URL(request.url).searchParams.get("business_id") ||
      new URL(request.url).searchParams.get("businessId") ||
      undefined

    const scope = await resolveBusinessScopeForUser(supabase, user.id, requestedBusinessId)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const { data: recurringInvoice, error } = await supabase
      .from("recurring_invoices")
      .select(
        `
        *,
        customers (
          id,
          name,
          email,
          phone,
          whatsapp_phone,
          address
        )
      `
      )
      .eq("id", id)
      .eq("business_id", scope.businessId)
      .is("deleted_at", null)
      .single()

    if (error || !recurringInvoice) {
      return NextResponse.json(
        { error: "Recurring invoice not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({ recurringInvoice })
  } catch (error: any) {
    console.error("Error fetching recurring invoice:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const { id } = await params
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const {
      customer_id,
      frequency,
      next_run_date,
      auto_send,
      auto_whatsapp,
      invoice_template_data,
      status,
    } = body

    const requestedBusinessId =
      (typeof body.business_id === "string" && body.business_id.trim()) ||
      new URL(request.url).searchParams.get("business_id") ||
      undefined

    const scope = await resolveBusinessScopeForUser(supabase, user.id, requestedBusinessId)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    // Verify recurring invoice exists and belongs to business
    const { data: existing } = await supabase
      .from("recurring_invoices")
      .select("id")
      .eq("id", id)
      .eq("business_id", scope.businessId)
      .single()

    if (!existing) {
      return NextResponse.json(
        { error: "Recurring invoice not found" },
        { status: 404 }
      )
    }

    const updateData: any = {
      updated_at: new Date().toISOString(),
    }

    if (customer_id !== undefined) updateData.customer_id = customer_id
    if (frequency) {
      const validFrequencies = ["weekly", "biweekly", "monthly", "quarterly", "yearly"]
      if (!validFrequencies.includes(frequency)) {
        return NextResponse.json(
          { error: "Invalid frequency" },
          { status: 400 }
        )
      }
      updateData.frequency = frequency
    }
    if (next_run_date) updateData.next_run_date = next_run_date
    if (auto_send !== undefined) updateData.auto_send = auto_send
    if (auto_whatsapp !== undefined) updateData.auto_whatsapp = auto_whatsapp
    if (invoice_template_data) {
      const applyTaxes = invoice_template_data?.apply_taxes === true
      if (applyTaxes) {
        const hasTaxLines =
          invoice_template_data.tax_lines &&
          Array.isArray(invoice_template_data.tax_lines?.lines)
        if (!hasTaxLines) {
          return NextResponse.json(
            { error: "When apply_taxes is true, invoice_template_data must include tax_lines with lines array" },
            { status: 400 }
          )
        }
      }
      updateData.invoice_template_data = invoice_template_data
    }
    if (status) {
      if (!["active", "paused"].includes(status)) {
        return NextResponse.json(
          { error: "Invalid status" },
          { status: 400 }
        )
      }
      updateData.status = status
    }

    const { data: recurringInvoice, error } = await supabase
      .from("recurring_invoices")
      .update(updateData)
      .eq("id", id)
      .eq("business_id", scope.businessId)
      .select()
      .single()

    if (error) {
      console.error("Error updating recurring invoice:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ recurringInvoice })
  } catch (error: any) {
    console.error("Error updating recurring invoice:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const { id } = await params
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const requestedBusinessId =
      new URL(request.url).searchParams.get("business_id") ||
      new URL(request.url).searchParams.get("businessId") ||
      undefined

    const scope = await resolveBusinessScopeForUser(supabase, user.id, requestedBusinessId)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    // Soft delete (must affect exactly one row)
    const { data: deletedRow, error } = await supabase
      .from("recurring_invoices")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("business_id", scope.businessId)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle()

    if (error) {
      console.error("Error deleting recurring invoice:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    if (!deletedRow) {
      return NextResponse.json(
        { error: "Recurring invoice not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error deleting recurring invoice:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

