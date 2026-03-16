import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    const { data: payment, error } = await supabase
      .from("payments")
      .select("*")
      .eq("id", id)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (error || !payment) {
      return NextResponse.json(
        { error: "Payment not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({ payment })
  } catch (error: any) {
    console.error("Error fetching payment:", error)
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
  const { id } = await params
  try {
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
    const {
      amount,
      date,
      method,
      reference,
      notes,
    } = body

    // Verify payment exists and belongs to business
    const { data: existingPayment } = await supabase
      .from("payments")
      .select("id, invoice_id")
      .eq("id", id)
      .eq("business_id", business.id)
      .single()

    if (!existingPayment) {
      return NextResponse.json(
        { error: "Payment not found" },
        { status: 404 }
      )
    }

    // Validate method
    const validMethods = ["cash", "bank", "momo", "card", "cheque", "other"]
    if (method && !validMethods.includes(method)) {
      return NextResponse.json(
        { error: "Invalid payment method" },
        { status: 400 }
      )
    }

    // Calculate E-Levy for mobile money
    let eLevyAmount = 0
    if (method === "momo" && amount) {
      eLevyAmount = Number(amount) * 0.015
    }

    const updateData: any = {
      updated_at: new Date().toISOString(),
    }

    if (amount !== undefined) updateData.amount = Number(amount)
    if (date) updateData.date = date
    if (method) updateData.method = method
    if (reference !== undefined) updateData.reference = reference
    if (notes !== undefined) updateData.notes = notes
    if (eLevyAmount > 0) updateData.e_levy_amount = eLevyAmount

    const { data: payment, error } = await supabase
      .from("payments")
      .update(updateData)
      .eq("id", id)
      .select()
      .single()

    if (error) {
      console.error("Error updating payment:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // The database trigger (trigger_update_invoice_status) will automatically:
    // 1. Call recalculate_invoice_status() which considers payments + credit notes
    // 2. Update invoice status based on ledger reality
    // 3. Handle overdue status based on due_date
    // 4. Set paid_at timestamp when status becomes 'paid'
    // No manual status update needed - trigger is the source of truth

    return NextResponse.json({ payment })
  } catch (error: any) {
    console.error("Error updating payment:", error)
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
  const { id } = await params
  try {
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

    // Verify payment exists and belongs to business
    const { data: existingPayment } = await supabase
      .from("payments")
      .select("id, invoice_id, created_at")
      .eq("id", id)
      .eq("business_id", business.id)
      .single()

    if (!existingPayment) {
      return NextResponse.json(
        { error: "Payment not found" },
        { status: 404 }
      )
    }

    // Only allow deletion if payment was created recently (within 5 minutes) - "draft" payments
    const createdAt = new Date(existingPayment.created_at)
    const now = new Date()
    const minutesSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60)

    if (minutesSinceCreation > 5) {
      return NextResponse.json(
        { error: "Only recent payments (within 5 minutes) can be deleted" },
        { status: 400 }
      )
    }

    // Soft delete payment
    const { error } = await supabase
      .from("payments")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)

    if (error) {
      console.error("Error deleting payment:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // The database trigger (trigger_update_invoice_status_on_payment_delete) will automatically:
    // 1. Call recalculate_invoice_status() when payment is soft-deleted
    // 2. Update invoice status based on remaining payments + credit notes
    // 3. Handle overdue status based on due_date
    // No manual status update needed - trigger is the source of truth

    // Log audit entry
    try {
      if (business) {
        await createAuditLog({
          businessId: business.id,
          userId: user?.id || null,
          actionType: "payment.deleted",
          entityType: "payment",
          entityId: id,
          oldValues: existingPayment,
          newValues: null,
          request,
          description: `Payment ${id} deleted`,
        })
      }
    } catch (auditError) {
      console.error("Error logging audit:", auditError)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error deleting payment:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

